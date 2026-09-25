import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './../src/transactions/dto/transaction-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const DONO = '0199a1b2-c3d4-7000-8000-0000000000aa';
const OUTRO = '0199a1b2-c3d4-7000-8000-0000000000bb';

interface Linha {
  id: string;
  userId: string;
  categoryId: string;
  type: 'receita' | 'despesa';
  amount: Prisma.Decimal;
  date: Date;
  description: string;
  source: 'formulario' | 'assistente';
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { name: string };
}

let contador = 0;

function linha(sobrescrever: Partial<Linha> = {}): Linha {
  contador += 1;
  const n = String(contador).padStart(12, '0');

  return {
    id: `0199a1b2-c3d4-7000-8000-${n}`,
    userId: DONO,
    categoryId: '0199a1b2-c3d4-7000-8000-00000000c001',
    type: 'despesa',
    amount: new Prisma.Decimal('10'),
    date: new Date('2026-09-01T00:00:00.000Z'),
    description: `Lançamento ${n}`,
    source: 'formulario',
    createdAt: new Date(
      `2026-09-01T10:00:${String(contador % 60).padStart(2, '0')}.000Z`,
    ),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    category: { name: 'Alimentação' },
    ...sobrescrever,
  };
}

/**
 * Tabela em memória que aplica o `where`, a ordem e a paginação que o service
 * pede. Um dublê de retorno fixo não provaria o isolamento entre usuários:
 * aqui, se o service esquecesse `userId` no filtro, os testes de vazamento
 * falhariam.
 */
function instalarTabela(prisma: PrismaStub, linhas: Linha[]) {
  const passa = (l: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => l[k as keyof Linha] === v);

  const ordenar = (a: Linha, b: Linha) =>
    b.date.getTime() - a.date.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : -1);

  prisma.transaction.findMany.mockImplementation(
    ({
      where,
      skip,
      take,
    }: {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    }) =>
      Promise.resolve(
        linhas
          .filter((l) => passa(l, where))
          .sort(ordenar)
          .slice(skip, skip + take),
      ),
  );
  prisma.transaction.count.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(linhas.filter((l) => passa(l, where)).length),
  );
  prisma.transaction.findFirst.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(linhas.find((l) => passa(l, where)) ?? null),
  );
}

const lista = (res: request.Response) => res.body as TransactionListResponseDto;
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('Leitura de lançamentos (TCC-013)', () => {
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

  describe('GET /api/transactions', () => {
    it('exige autenticação', async () => {
      await request(app.getHttpServer()).get('/api/transactions').expect(401);
      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    });

    it('sem lançamentos devolve lista vazia e meta zerada', async () => {
      const res = await get('/api/transactions').expect(200);

      expect(lista(res)).toEqual({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
    });

    it('devolve o contrato completo, com categoria, valor e data civil', async () => {
      linhas.push(
        linha({
          amount: new Prisma.Decimal('35.9'),
          date: new Date('2026-08-31T00:00:00.000Z'),
          category: { name: 'Transporte' },
        }),
      );

      const res = await get('/api/transactions').expect(200);

      expect(lista(res).data[0]).toMatchObject({
        type: 'despesa',
        amount: '35.90',
        date: '2026-08-31',
        categoryName: 'Transporte',
        source: 'formulario',
      });
    });

    it('mostra apenas os lançamentos do usuário autenticado', async () => {
      const meu = linha({ description: 'Meu' });
      linhas.push(meu, linha({ userId: OUTRO, description: 'Do outro' }));

      const res = await get('/api/transactions').expect(200);

      expect(lista(res).data.map((l) => l.description)).toEqual(['Meu']);
      expect(lista(res).meta.total).toBe(1);
    });

    it('não lista lançamento excluído', async () => {
      linhas.push(
        linha({ description: 'Ativo' }),
        linha({ description: 'Excluído', deletedAt: new Date() }),
      );

      const res = await get('/api/transactions').expect(200);

      expect(lista(res).data.map((l) => l.description)).toEqual(['Ativo']);
    });

    it('ordena do mais recente ao mais antigo', async () => {
      linhas.push(
        linha({
          description: 'antigo',
          date: new Date('2026-07-01T00:00:00Z'),
        }),
        linha({ description: 'novo', date: new Date('2026-09-10T00:00:00Z') }),
        linha({ description: 'meio', date: new Date('2026-08-01T00:00:00Z') }),
      );

      const res = await get('/api/transactions').expect(200);

      expect(lista(res).data.map((l) => l.description)).toEqual([
        'novo',
        'meio',
        'antigo',
      ]);
    });

    it('não vaza o dono nem a exclusão lógica', async () => {
      linhas.push(linha());

      const res = await get('/api/transactions').expect(200);

      const item = lista(res).data[0];
      expect(item).not.toHaveProperty('userId');
      expect(item).not.toHaveProperty('deletedAt');
      expect(item).not.toHaveProperty('category');
    });

    it('não guarda resposta em cache', async () => {
      const res = await get('/api/transactions').expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    describe('paginação', () => {
      beforeEach(() => {
        for (let i = 0; i < 25; i++) {
          linhas.push(
            linha({
              date: new Date(Date.UTC(2026, 0, 1 + i)),
              description: `Item ${i}`,
            }),
          );
        }
      });

      it('usa 20 por página por padrão e informa o total', async () => {
        const res = await get('/api/transactions').expect(200);

        expect(lista(res).data).toHaveLength(20);
        expect(lista(res).meta).toEqual({
          page: 1,
          pageSize: 20,
          total: 25,
          totalPages: 2,
        });
      });

      it('a segunda página traz o restante, sem repetir itens da primeira', async () => {
        const p1 = await get('/api/transactions?page=1').expect(200);
        const p2 = await get('/api/transactions?page=2').expect(200);

        expect(lista(p2).data).toHaveLength(5);
        const ids1 = lista(p1).data.map((l) => l.id);
        expect(lista(p2).data.some((l) => ids1.includes(l.id))).toBe(false);
      });

      it('página além do fim devolve lista vazia, não erro', async () => {
        const res = await get('/api/transactions?page=9').expect(200);

        expect(lista(res).data).toEqual([]);
        expect(lista(res).meta.total).toBe(25);
      });

      it('respeita pageSize', async () => {
        const res = await get('/api/transactions?pageSize=10').expect(200);

        expect(lista(res).data).toHaveLength(10);
        expect(lista(res).meta.totalPages).toBe(3);
      });

      it.each([
        'page=0',
        'page=-1',
        'page=abc',
        'page=1.5',
        'pageSize=0',
        'pageSize=101',
        'pageSize=999999',
        'pageSize=abc',
        'page=99999999',
      ])('recusa %s', async (consulta) => {
        await get(`/api/transactions?${consulta}`).expect(400);

        expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      });

      it('recusa parâmetro que não existe, inclusive tentativa de escolher o dono', async () => {
        const res = await get(`/api/transactions?userId=${OUTRO}`).expect(400);

        expect(erro(res).fieldErrors).toHaveProperty('userId');
        expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('GET /api/transactions/:id', () => {
    it('exige autenticação', async () => {
      const item = linha();
      linhas.push(item);

      await request(app.getHttpServer())
        .get(`/api/transactions/${item.id}`)
        .expect(401);
    });

    it('devolve todos os dados do lançamento', async () => {
      const item = linha({
        amount: new Prisma.Decimal('1234.5'),
        source: 'assistente',
        description: 'Freela do mês',
        type: 'receita',
      });
      linhas.push(item);

      const res = await get(`/api/transactions/${item.id}`).expect(200);

      expect(res.body as TransactionResponseDto).toEqual({
        id: item.id,
        type: 'receita',
        amount: '1234.50',
        date: '2026-09-01',
        description: 'Freela do mês',
        categoryId: item.categoryId,
        categoryName: 'Alimentação',
        source: 'assistente',
        createdAt: item.createdAt.toISOString(),
        updatedAt: '2026-09-01T10:00:00.000Z',
      });
    });

    it('lançamento de outro usuário responde 404, igual ao inexistente', async () => {
      const alheio = linha({ userId: OUTRO });
      linhas.push(alheio);

      const doOutro = await get(`/api/transactions/${alheio.id}`).expect(404);
      const inexistente = await get(
        '/api/transactions/0199a1b2-c3d4-7000-8000-ffffffffffff',
      ).expect(404);

      expect(erro(doOutro).message).toBe('Lançamento não encontrado.');
      expect(erro(inexistente).message).toBe(erro(doOutro).message);
      expect(JSON.stringify(doOutro.body)).not.toContain('Lançamento 0');
    });

    it('lançamento excluído responde 404', async () => {
      const excluido = linha({ deletedAt: new Date() });
      linhas.push(excluido);

      await get(`/api/transactions/${excluido.id}`).expect(404);
    });

    it.each([
      'abc',
      '1',
      "1' OR '1'='1",
      '00000000-0000-0000-0000-00000000000',
    ])('id malformado %j responde 404 sem consultar o banco', async (id) => {
      const res = await get(
        `/api/transactions/${encodeURIComponent(id)}`,
      ).expect(404);

      expect(erro(res).message).toBe('Lançamento não encontrado.');
      expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('consulta sempre com dono e exclusão lógica no filtro', async () => {
      const item = linha();
      linhas.push(item);

      await get(`/api/transactions/${item.id}`).expect(200);

      expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: item.id, userId: DONO, deletedAt: null },
        }),
      );
    });
  });
});
