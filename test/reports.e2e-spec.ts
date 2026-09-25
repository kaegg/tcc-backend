import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { PeriodSummaryResponseDto } from './../src/reports/dto/period-summary-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const DONO = '0199a1b2-c3d4-7000-8000-0000000000aa';
const OUTRO = '0199a1b2-c3d4-7000-8000-0000000000bb';

interface Linha {
  userId: string;
  type: 'receita' | 'despesa';
  amount: Prisma.Decimal;
  date: Date;
  deletedAt: Date | null;
}

function linha(
  type: Linha['type'],
  amount: string,
  date: string,
  sobrescrever: Partial<Linha> = {},
): Linha {
  return {
    userId: DONO,
    type,
    amount: new Prisma.Decimal(amount),
    date: new Date(`${date}T00:00:00.000Z`),
    deletedAt: null,
    ...sobrescrever,
  };
}

type Filtro = Record<string, unknown>;

function passa(l: Linha, where: Filtro): boolean {
  return Object.entries(where).every(([campo, condicao]) => {
    if (campo === 'date') {
      const { gte, lte } = condicao as { gte?: Date; lte?: Date };
      const t = l.date.getTime();
      return (!gte || t >= gte.getTime()) && (!lte || t <= lte.getTime());
    }
    return l[campo as keyof Linha] === condicao;
  });
}

/**
 * `groupBy` em memória: aplica o `where` e soma em `Decimal`, como o
 * PostgreSQL soma `numeric`. Os resultados esperados nos testes foram
 * calculados à mão.
 */
function instalarTabela(prisma: PrismaStub, linhas: Linha[]) {
  prisma.transaction.groupBy.mockImplementation(
    ({ where }: { where: Filtro }) => {
      const grupos = new Map<string, { soma: Prisma.Decimal; n: number }>();
      for (const l of linhas.filter((x) => passa(x, where))) {
        const atual = grupos.get(l.type) ?? {
          soma: new Prisma.Decimal(0),
          n: 0,
        };
        grupos.set(l.type, { soma: atual.soma.plus(l.amount), n: atual.n + 1 });
      }
      return Promise.resolve(
        [...grupos].map(([type, { soma, n }]) => ({
          type,
          _sum: { amount: soma },
          _count: { _all: n },
        })),
      );
    },
  );
}

const resumo = (res: request.Response) => res.body as PeriodSummaryResponseDto;
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('GET /api/reports/summary (TCC-016)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;
  let linhas: Linha[];

  beforeEach(async () => {
    linhas = [];
    prisma = createPrismaStub();
    instalarTabela(prisma, linhas);
    app = await createTestApp(prisma);
    authorization = await authenticateFakeUser(prisma, app);
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (consulta: string) =>
    request(app.getHttpServer())
      .get(`/api/reports/summary?${consulta}`)
      .set('Authorization', authorization);

  const SETEMBRO = 'from=2026-09-01&to=2026-09-30';

  describe('totais com resultado conhecido', () => {
    it('soma receitas, despesas e calcula o saldo', async () => {
      linhas.push(
        linha('receita', '1500.00', '2026-09-05'),
        linha('receita', '250.10', '2026-09-20'),
        linha('despesa', '35.90', '2026-09-02'),
        linha('despesa', '1200.00', '2026-09-10'),
        linha('despesa', '0.10', '2026-09-11'),
        linha('despesa', '0.20', '2026-09-12'),
      );

      const res = await get(SETEMBRO).expect(200);

      // 1500.00 + 250.10 = 1750.10
      // 35.90 + 1200.00 + 0.10 + 0.20 = 1236.20
      // 1750.10 − 1236.20 = 513.90
      expect(resumo(res)).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
        income: '1750.10',
        expense: '1236.20',
        balance: '513.90',
        transactionCount: 6,
      });
    });

    it('soma centavos sem erro de ponto flutuante', async () => {
      linhas.push(
        linha('despesa', '0.10', '2026-09-01'),
        linha('despesa', '0.20', '2026-09-01'),
      );

      const res = await get(SETEMBRO).expect(200);

      // Em number, 0.1 + 0.2 = 0.30000000000000004.
      expect(resumo(res).expense).toBe('0.30');
      expect(resumo(res).balance).toBe('-0.30');
    });

    it('saldo negativo sai com sinal', async () => {
      linhas.push(
        linha('receita', '100.00', '2026-09-01'),
        linha('despesa', '150.55', '2026-09-02'),
      );

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res)).toMatchObject({
        income: '100.00',
        expense: '150.55',
        balance: '-50.55',
      });
    });

    it('período sem lançamentos responde zeros, não erro', async () => {
      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res)).toMatchObject({
        income: '0.00',
        expense: '0.00',
        balance: '0.00',
        transactionCount: 0,
      });
    });

    it('só receitas: despesas zeradas', async () => {
      linhas.push(linha('receita', '42.00', '2026-09-15'));

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res)).toMatchObject({
        income: '42.00',
        expense: '0.00',
        balance: '42.00',
        transactionCount: 1,
      });
    });

    it('totais acima do limite de uma linha não estouram', async () => {
      linhas.push(
        linha('receita', '9999999999.99', '2026-09-01'),
        linha('receita', '9999999999.99', '2026-09-02'),
      );

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res).income).toBe('19999999999.98');
    });
  });

  describe('o que entra na conta', () => {
    it('as duas pontas do período são inclusivas', async () => {
      linhas.push(
        linha('despesa', '1.00', '2026-08-31'),
        linha('despesa', '10.00', '2026-09-01'),
        linha('despesa', '100.00', '2026-09-30'),
        linha('despesa', '1000.00', '2026-10-01'),
      );

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res).expense).toBe('110.00');
      expect(resumo(res).transactionCount).toBe(2);
    });

    it('lançamento excluído não entra (RN09)', async () => {
      linhas.push(
        linha('despesa', '50.00', '2026-09-10'),
        linha('despesa', '999.00', '2026-09-10', { deletedAt: new Date() }),
      );

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res).expense).toBe('50.00');
      expect(resumo(res).transactionCount).toBe(1);
    });

    it('lançamento de outro usuário não entra (RN07)', async () => {
      linhas.push(
        linha('receita', '10.00', '2026-09-10'),
        linha('receita', '5000.00', '2026-09-10', { userId: OUTRO }),
      );

      const res = await get(SETEMBRO).expect(200);

      expect(resumo(res).income).toBe('10.00');
    });

    it('consulta com dono do token, exclusão lógica e período no where', async () => {
      await get(SETEMBRO).expect(200);

      expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['type'],
          where: {
            date: {
              gte: new Date('2026-09-01T00:00:00.000Z'),
              lte: new Date('2026-09-30T00:00:00.000Z'),
            },
            userId: DONO,
            deletedAt: null,
          },
        }),
      );
    });
  });

  describe('acesso e contrato', () => {
    it('exige autenticação', async () => {
      await request(app.getHttpServer())
        .get(`/api/reports/summary?${SETEMBRO}`)
        .expect(401);

      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('não guarda resposta em cache', async () => {
      const res = await get(SETEMBRO).expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each([
      `${SETEMBRO}&userId=${OUTRO}`,
      `${SETEMBRO}&deletedAt=`,
      `${SETEMBRO}&includeDeleted=true`,
    ])('recusa parâmetro fora do contrato: %s', async (consulta) => {
      await get(consulta).expect(400);

      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('validação do período', () => {
    it.each([
      ['to=2026-09-30', 'from', 'Informe a data.'],
      ['from=2026-09-01', 'to', 'Informe a data.'],
      ['from=2026-02-30&to=2026-03-01', 'from', 'Informe uma data válida.'],
      ['from=01/09/2026&to=2026-09-30', 'from', 'Informe uma data válida.'],
      ['from=1999-12-31&to=2026-09-30', 'from', 'Informe uma data válida.'],
      [
        'from=2026-09-30&to=2026-09-01',
        'to',
        'A data final deve ser igual ou posterior à inicial.',
      ],
      [
        'from=2026-09-01&from=2026-09-02&to=2026-09-30',
        'from',
        'Informe a data.',
      ],
    ])('recusa %s', async (consulta, campo, mensagem) => {
      const res = await get(consulta).expect(400);

      expect(erro(res).fieldErrors?.[campo]).toContain(mensagem);
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('aceita período de um único dia', async () => {
      linhas.push(linha('despesa', '7.00', '2026-09-15'));

      const res = await get('from=2026-09-15&to=2026-09-15').expect(200);

      expect(resumo(res).expense).toBe('7.00');
    });
  });
});
