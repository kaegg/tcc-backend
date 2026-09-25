import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { MonthlySummaryResponseDto } from './../src/reports/dto/monthly-summary-response.dto';
import type { PeriodSummaryResponseDto } from './../src/reports/dto/period-summary-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const DONO = '0199a1b2-c3d4-7000-8000-0000000000aa';
const OUTRO = '0199a1b2-c3d4-7000-8000-0000000000bb';

const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';
const TRANSPORTE = '0199a1b2-c3d4-7000-8000-00000000c002';
const MORADIA = '0199a1b2-c3d4-7000-8000-00000000c003';
const ANTIGA = '0199a1b2-c3d4-7000-8000-00000000c009';
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';
const FREELA = '0199a1b2-c3d4-7000-8000-00000000c102';

/** Inclui uma categoria inativa: o nome precisa aparecer mesmo assim. */
const CATEGORIAS = [
  { id: ALIMENTACAO, name: 'Alimentação', isActive: true },
  { id: TRANSPORTE, name: 'Transporte', isActive: true },
  { id: MORADIA, name: 'Moradia', isActive: true },
  { id: ANTIGA, name: 'Assinaturas', isActive: false },
  { id: SALARIO, name: 'Salário', isActive: true },
  { id: FREELA, name: 'Freelance', isActive: true },
];

interface Linha {
  userId: string;
  categoryId: string;
  type: 'receita' | 'despesa';
  amount: Prisma.Decimal;
  date: Date;
  deletedAt: Date | null;
}

function linha(
  type: Linha['type'],
  categoryId: string,
  amount: string,
  date: string,
  sobrescrever: Partial<Linha> = {},
): Linha {
  return {
    userId: DONO,
    categoryId,
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
 * `groupBy` em memória pelas colunas pedidas, somando em `Decimal` como o
 * PostgreSQL soma `numeric`. Os valores esperados foram calculados à mão.
 */
function instalarTabela(prisma: PrismaStub, linhas: Linha[]) {
  prisma.transaction.groupBy.mockImplementation(
    ({ by, where }: { by: (keyof Linha)[]; where: Filtro }) => {
      const grupos = new Map<
        string,
        { chave: Partial<Linha>; soma: Prisma.Decimal; n: number }
      >();
      for (const l of linhas.filter((x) => passa(x, where))) {
        const chave = Object.fromEntries(by.map((c) => [c, l[c]]));
        const id = JSON.stringify(chave);
        const atual = grupos.get(id) ?? {
          chave,
          soma: new Prisma.Decimal(0),
          n: 0,
        };
        grupos.set(id, {
          chave,
          soma: atual.soma.plus(l.amount),
          n: atual.n + 1,
        });
      }
      return Promise.resolve(
        [...grupos.values()].map(({ chave, soma, n }) => ({
          ...chave,
          _sum: { amount: soma },
          _count: { _all: n },
        })),
      );
    },
  );

  prisma.category.findMany.mockImplementation(
    ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        CATEGORIAS.filter((c) => where.id.in.includes(c.id)).map(
          ({ id, name }) => ({ id, name }),
        ),
      ),
  );
}

const resumo = (res: request.Response) => res.body as MonthlySummaryResponseDto;
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;
const soma = (valores: string[]) =>
  valores.reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0)).toFixed(2);

describe('GET /api/reports/monthly (TCC-017)', () => {
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

  const get = (url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', authorization);

  /**
   * Setembro de 2026, com resultado calculado à mão:
   *
   * receitas: Salário 3000.00 + Freelance 450.25 + 49.75 = 3500.00
   * despesas: Moradia 1200.00, Alimentação 35.90 + 64.10 + 0.10 + 0.20 = 100.30,
   *           Transporte 100.30, Assinaturas (inativa) 39.90 → 1440.50
   * saldo: 3500.00 − 1440.50 = 2059.50
   */
  function setembro() {
    linhas.push(
      linha('receita', SALARIO, '3000.00', '2026-09-05'),
      linha('receita', FREELA, '450.25', '2026-09-12'),
      linha('receita', FREELA, '49.75', '2026-09-30'),
      linha('despesa', MORADIA, '1200.00', '2026-09-01'),
      linha('despesa', ALIMENTACAO, '35.90', '2026-09-02'),
      linha('despesa', ALIMENTACAO, '64.10', '2026-09-15'),
      linha('despesa', ALIMENTACAO, '0.10', '2026-09-16'),
      linha('despesa', ALIMENTACAO, '0.20', '2026-09-17'),
      linha('despesa', TRANSPORTE, '100.30', '2026-09-20'),
      linha('despesa', ANTIGA, '39.90', '2026-09-08'),
      // Fora da conta:
      linha('despesa', ALIMENTACAO, '500.00', '2026-08-31'),
      linha('despesa', ALIMENTACAO, '500.00', '2026-10-01'),
      linha('despesa', ALIMENTACAO, '500.00', '2026-09-10', {
        deletedAt: new Date(),
      }),
      linha('receita', SALARIO, '9999.00', '2026-09-05', { userId: OUTRO }),
    );
  }

  describe('resultado conhecido', () => {
    it('consolida receitas, despesas e saldo do mês', async () => {
      setembro();

      const res = await get('/api/reports/monthly?month=2026-09').expect(200);

      expect(resumo(res)).toMatchObject({
        month: '2026-09',
        from: '2026-09-01',
        to: '2026-09-30',
        income: '3500.00',
        expense: '1440.50',
        balance: '2059.50',
        transactionCount: 10,
      });
    });

    it('distribui por categoria, do maior para o menor, com empate pelo nome', async () => {
      setembro();

      const res = await get('/api/reports/monthly?month=2026-09').expect(200);

      expect(resumo(res).expenseByCategory).toEqual([
        {
          categoryId: MORADIA,
          categoryName: 'Moradia',
          total: '1200.00',
          transactionCount: 1,
          share: '83.30',
        },
        {
          categoryId: ALIMENTACAO,
          categoryName: 'Alimentação',
          total: '100.30',
          transactionCount: 4,
          share: '6.96',
        },
        {
          categoryId: TRANSPORTE,
          categoryName: 'Transporte',
          total: '100.30',
          transactionCount: 1,
          share: '6.96',
        },
        {
          categoryId: ANTIGA,
          categoryName: 'Assinaturas',
          total: '39.90',
          transactionCount: 1,
          share: '2.77',
        },
      ]);
      expect(resumo(res).incomeByCategory).toEqual([
        {
          categoryId: SALARIO,
          categoryName: 'Salário',
          total: '3000.00',
          transactionCount: 1,
          share: '85.71',
        },
        {
          categoryId: FREELA,
          categoryName: 'Freelance',
          total: '500.00',
          transactionCount: 2,
          share: '14.29',
        },
      ]);
    });

    it('a distribuição totaliza exatamente o mês', async () => {
      setembro();

      const r = resumo(
        await get('/api/reports/monthly?month=2026-09').expect(200),
      );

      expect(soma(r.expenseByCategory.map((c) => c.total))).toBe(r.expense);
      expect(soma(r.incomeByCategory.map((c) => c.total))).toBe(r.income);
      expect(
        [...r.expenseByCategory, ...r.incomeByCategory].reduce(
          (acc, c) => acc + c.transactionCount,
          0,
        ),
      ).toBe(r.transactionCount);
    });

    it('bate com o relatório por período do mesmo intervalo', async () => {
      setembro();
      prisma.transaction.groupBy.mockClear();

      const mensal = resumo(
        await get('/api/reports/monthly?month=2026-09').expect(200),
      );
      const periodo = (
        await get('/api/reports/summary?from=2026-09-01&to=2026-09-30').expect(
          200,
        )
      ).body as PeriodSummaryResponseDto;

      expect({
        income: mensal.income,
        expense: mensal.expense,
        balance: mensal.balance,
        transactionCount: mensal.transactionCount,
      }).toEqual({
        income: periodo.income,
        expense: periodo.expense,
        balance: periodo.balance,
        transactionCount: periodo.transactionCount,
      });

      const [[doMes], [doPeriodo]] = prisma.transaction.groupBy.mock.calls as [
        [{ where: unknown }],
        [{ where: unknown }],
      ];
      expect(doMes.where).toEqual(doPeriodo.where);
    });

    it('fevereiro de ano bissexto inclui o dia 29', async () => {
      linhas.push(
        linha('despesa', ALIMENTACAO, '10.00', '2028-02-29'),
        linha('despesa', ALIMENTACAO, '99.00', '2028-03-01'),
      );

      const r = resumo(
        await get('/api/reports/monthly?month=2028-02').expect(200),
      );

      expect(r.to).toBe('2028-02-29');
      expect(r.expense).toBe('10.00');
    });

    it('mês sem lançamentos responde zeros e listas vazias, sem consultar categorias', async () => {
      const r = resumo(
        await get('/api/reports/monthly?month=2026-09').expect(200),
      );

      expect(r).toEqual({
        month: '2026-09',
        from: '2026-09-01',
        to: '2026-09-30',
        income: '0.00',
        expense: '0.00',
        balance: '0.00',
        transactionCount: 0,
        incomeByCategory: [],
        expenseByCategory: [],
      });
      expect(prisma.category.findMany).not.toHaveBeenCalled();
    });

    it('uma única categoria tem 100% do tipo', async () => {
      linhas.push(linha('despesa', MORADIA, '0.01', '2026-09-01'));

      const r = resumo(
        await get('/api/reports/monthly?month=2026-09').expect(200),
      );

      expect(r.expenseByCategory[0].share).toBe('100.00');
      expect(r.balance).toBe('-0.01');
    });
  });

  describe('acesso e contrato', () => {
    it('exige autenticação', async () => {
      await request(app.getHttpServer())
        .get('/api/reports/monthly?month=2026-09')
        .expect(401);

      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('consulta com dono do token e exclusão lógica', async () => {
      await get('/api/reports/monthly?month=2026-09').expect(200);

      expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['type', 'categoryId'],
          where: expect.objectContaining({
            userId: DONO,
            deletedAt: null,
          }) as unknown,
        }),
      );
    });

    it('não guarda resposta em cache', async () => {
      const res = await get('/api/reports/monthly?month=2026-09').expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each([
      `month=2026-09&userId=${OUTRO}`,
      'month=2026-09&from=2026-01-01',
      'month=2026-09&categoryId=x',
    ])('recusa parâmetro fora do contrato: %s', async (consulta) => {
      await get(`/api/reports/monthly?${consulta}`).expect(400);

      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it.each([
      ['', 'Informe o mês.'],
      ['month=', 'Informe o mês.'],
      ['month=2026-13', 'Informe um mês válido.'],
      ['month=2026-9', 'Informe um mês válido.'],
      ['month=09%2F2026', 'Informe um mês válido.'],
      ['month=1999-12', 'Informe um mês válido.'],
      ['month=2026-09&month=2026-10', 'Informe o mês.'],
      [
        `month=${encodeURIComponent("2026-09' OR '1'='1")}`,
        'Informe um mês válido.',
      ],
    ])('recusa %j', async (consulta, mensagem) => {
      const res = await get(`/api/reports/monthly?${consulta}`).expect(400);

      expect(erro(res).fieldErrors?.month).toEqual([mensagem]);
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });
  });
});
