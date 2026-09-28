import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { PeriodSummaryResponseDto } from './../src/reports/dto/period-summary-response.dto';
import type { ReportOverviewResponseDto } from './../src/reports/dto/report-overview-response.dto';
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
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';

const NOMES: Record<string, string> = {
  [ALIMENTACAO]: 'Alimentação',
  [TRANSPORTE]: 'Transporte',
  [MORADIA]: 'Moradia',
  [SALARIO]: 'Salário',
};

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

/** `groupBy` em memória pelas colunas pedidas, somando em `Decimal`. */
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
        where.id.in.map((id) => ({ id, name: NOMES[id] ?? '?' })),
      ),
  );
}

const visao = (res: request.Response) => res.body as ReportOverviewResponseDto;
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;
const soma = (valores: string[]) =>
  valores.reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0)).toFixed(2);

describe('GET /api/reports/overview (TCC-018)', () => {
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

  const PERIODO = 'from=2026-08-15&to=2026-10-10';

  /**
   * De 15/08 a 10/10 de 2026, com resultado calculado à mão:
   *
   * agosto (15–31):  receitas 1000.00, despesas 50.25    → saldo 949.75, 2 lanç.
   * setembro:        receitas 3000.00, despesas 1200.30  → saldo 1799.70, 4 lanç.
   * outubro (1–10):  receitas 0.00,    despesas 30.00    → saldo −30.00, 1 lanç.
   * total:           receitas 4000.00, despesas 1280.55  → saldo 2719.45, 7 lanç.
   * economia: 2719.45 / 4000.00 = 67,98625% → 67,99%
   */
  function periodo() {
    linhas.push(
      linha('despesa', ALIMENTACAO, '999.00', '2026-08-14'),
      linha('receita', SALARIO, '1000.00', '2026-08-15'),
      linha('despesa', ALIMENTACAO, '50.25', '2026-08-31'),
      linha('receita', SALARIO, '3000.00', '2026-09-05'),
      linha('despesa', MORADIA, '1200.00', '2026-09-10'),
      linha('despesa', ALIMENTACAO, '0.10', '2026-09-10'),
      linha('despesa', ALIMENTACAO, '0.20', '2026-09-10'),
      linha('despesa', TRANSPORTE, '30.00', '2026-10-10'),
      linha('despesa', ALIMENTACAO, '999.00', '2026-10-11'),
      linha('despesa', MORADIA, '500.00', '2026-09-20', {
        deletedAt: new Date(),
      }),
      linha('receita', SALARIO, '9999.00', '2026-09-05', { userId: OUTRO }),
    );
  }

  describe('resultado conhecido', () => {
    it('totais e taxa de economia do período', async () => {
      periodo();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );

      expect(r).toMatchObject({
        from: '2026-08-15',
        to: '2026-10-10',
        income: '4000.00',
        expense: '1280.55',
        balance: '2719.45',
        savingsRate: '67.99',
        transactionCount: 7,
      });
    });

    it('série mês a mês, com o primeiro e o último mês recortados', async () => {
      periodo();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );

      expect(r.months).toEqual([
        {
          month: '2026-08',
          from: '2026-08-15',
          to: '2026-08-31',
          income: '1000.00',
          expense: '50.25',
          balance: '949.75',
          transactionCount: 2,
        },
        {
          month: '2026-09',
          from: '2026-09-01',
          to: '2026-09-30',
          income: '3000.00',
          expense: '1200.30',
          balance: '1799.70',
          transactionCount: 4,
        },
        {
          month: '2026-10',
          from: '2026-10-01',
          to: '2026-10-10',
          income: '0.00',
          expense: '30.00',
          balance: '-30.00',
          transactionCount: 1,
        },
      ]);
    });

    it('distribuição por categoria do período inteiro', async () => {
      periodo();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );

      // 1200.00 / 1280.55 = 93,71%; 50.55 / 1280.55 = 3,95%; 30.00 / 1280.55 = 2,34%
      expect(r.expenseByCategory).toEqual([
        {
          categoryId: MORADIA,
          categoryName: 'Moradia',
          total: '1200.00',
          transactionCount: 1,
          share: '93.71',
        },
        {
          categoryId: ALIMENTACAO,
          categoryName: 'Alimentação',
          total: '50.55',
          transactionCount: 3,
          share: '3.95',
        },
        {
          categoryId: TRANSPORTE,
          categoryName: 'Transporte',
          total: '30.00',
          transactionCount: 1,
          share: '2.34',
        },
      ]);
      expect(r.incomeByCategory).toEqual([
        {
          categoryId: SALARIO,
          categoryName: 'Salário',
          total: '4000.00',
          transactionCount: 2,
          share: '100.00',
        },
      ]);
    });
  });

  describe('cartões, gráficos e tabela concordam', () => {
    it('a soma dos meses é igual aos totais', async () => {
      periodo();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );

      expect(soma(r.months.map((m) => m.income))).toBe(r.income);
      expect(soma(r.months.map((m) => m.expense))).toBe(r.expense);
      expect(soma(r.months.map((m) => m.balance))).toBe(r.balance);
      expect(r.months.reduce((acc, m) => acc + m.transactionCount, 0)).toBe(
        r.transactionCount,
      );
    });

    it('a soma das categorias é igual aos totais', async () => {
      periodo();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );

      expect(soma(r.expenseByCategory.map((c) => c.total))).toBe(r.expense);
      expect(soma(r.incomeByCategory.map((c) => c.total))).toBe(r.income);
    });

    it('bate com o relatório por período, com o mesmo where', async () => {
      periodo();
      prisma.transaction.groupBy.mockClear();

      const r = visao(
        await get(`/api/reports/overview?${PERIODO}`).expect(200),
      );
      const s = (await get(`/api/reports/summary?${PERIODO}`).expect(200))
        .body as PeriodSummaryResponseDto;

      expect({
        income: r.income,
        expense: r.expense,
        balance: r.balance,
        savingsRate: r.savingsRate,
        transactionCount: r.transactionCount,
      }).toEqual({
        income: s.income,
        expense: s.expense,
        balance: s.balance,
        savingsRate: s.savingsRate,
        transactionCount: s.transactionCount,
      });

      const [[daVisao], [doResumo]] = prisma.transaction.groupBy.mock.calls as [
        [{ where: unknown }],
        [{ where: unknown }],
      ];
      expect(daVisao.where).toEqual(doResumo.where);
    });

    it('meses sem lançamento aparecem zerados, sem buracos na série', async () => {
      const r = visao(
        await get('/api/reports/overview?from=2026-01-01&to=2026-03-31').expect(
          200,
        ),
      );

      expect(r.months.map((m) => [m.month, m.income, m.expense])).toEqual([
        ['2026-01', '0.00', '0.00'],
        ['2026-02', '0.00', '0.00'],
        ['2026-03', '0.00', '0.00'],
      ]);
      expect(r.savingsRate).toBeNull();
      expect(prisma.category.findMany).not.toHaveBeenCalled();
    });
  });

  describe('acesso e contrato', () => {
    it('exige autenticação', async () => {
      await request(app.getHttpServer())
        .get(`/api/reports/overview?${PERIODO}`)
        .expect(401);

      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('agrupa por tipo, categoria e dia, com dono e exclusão lógica', async () => {
      await get(`/api/reports/overview?${PERIODO}`).expect(200);

      expect(prisma.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['type', 'categoryId', 'date'],
          where: expect.objectContaining({
            userId: DONO,
            deletedAt: null,
          }) as unknown,
        }),
      );
    });

    it('não guarda resposta em cache', async () => {
      const res = await get(`/api/reports/overview?${PERIODO}`).expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each([`${PERIODO}&userId=${OUTRO}`, `${PERIODO}&month=2026-09`])(
      'recusa parâmetro fora do contrato: %s',
      async (consulta) => {
        await get(`/api/reports/overview?${consulta}`).expect(400);

        expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
      },
    );
  });

  describe('validação do período', () => {
    it('aceita até 24 meses', async () => {
      const r = visao(
        await get('/api/reports/overview?from=2025-01-01&to=2026-12-31').expect(
          200,
        ),
      );

      expect(r.months).toHaveLength(24);
    });

    it.each([
      [
        'from=2025-01-01&to=2027-01-01',
        'to',
        'O período deve ter no máximo 24 meses.',
      ],
      [
        'from=2000-01-01&to=2100-01-01',
        'to',
        'O período deve ter no máximo 24 meses.',
      ],
      [
        'from=2026-09-30&to=2026-09-01',
        'to',
        'A data final deve ser igual ou posterior à inicial.',
      ],
      ['to=2026-09-30', 'from', 'Informe a data.'],
      ['from=2026-09-01', 'to', 'Informe a data.'],
      ['from=2026-02-30&to=2026-03-31', 'from', 'Informe uma data válida.'],
    ])('recusa %s', async (consulta, campo, mensagem) => {
      const res = await get(`/api/reports/overview?${consulta}`).expect(400);

      expect(erro(res).fieldErrors?.[campo]).toContain(mensagem);
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });
  });
});
