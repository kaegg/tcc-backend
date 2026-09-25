import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { TransactionListResponseDto } from './../src/transactions/dto/transaction-response.dto';
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
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';

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

function linha(
  description: string,
  date: string,
  sobrescrever: Partial<Linha> = {},
): Linha {
  contador += 1;
  const n = String(contador).padStart(12, '0');

  return {
    id: `0199a1b2-c3d4-7000-8000-${n}`,
    userId: DONO,
    categoryId: ALIMENTACAO,
    type: 'despesa',
    amount: new Prisma.Decimal('10'),
    date: new Date(`${date}T00:00:00.000Z`),
    description,
    source: 'formulario',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    category: { name: 'Categoria' },
    ...sobrescrever,
  };
}

/**
 * Converte o padrão do ILIKE em expressão regular, respeitando a barra
 * invertida como escape — a mesma leitura do PostgreSQL. Com isso o teste
 * prova o efeito do escape dos curingas, e não só a string enviada.
 */
function ilike(texto: string, padrao: string): boolean {
  let regex = '';
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === '\\') {
      i += 1;
      regex += (padrao[i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (c === '%') regex += '.*';
    else if (c === '_') regex += '.';
    else regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${regex}$`, 'is').test(texto);
}

type Filtro = Record<string, unknown>;

function passa(l: Linha, where: Filtro): boolean {
  return Object.entries(where).every(([campo, condicao]) => {
    const valor = l[campo as keyof Linha];

    if (campo === 'date') {
      const { gte, lte } = condicao as { gte?: Date; lte?: Date };
      const t = (valor as Date).getTime();
      return (!gte || t >= gte.getTime()) && (!lte || t <= lte.getTime());
    }

    if (campo === 'description') {
      const { contains, mode } = condicao as {
        contains: string;
        mode: string;
      };
      expect(mode).toBe('insensitive');
      return ilike(valor as string, `%${contains}%`);
    }

    return valor === condicao;
  });
}

function instalarTabela(prisma: PrismaStub, linhas: Linha[]) {
  const ordenar = (a: Linha, b: Linha) =>
    b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : -1);

  prisma.transaction.findMany.mockImplementation(
    ({ where, skip, take }: { where: Filtro; skip: number; take: number }) =>
      Promise.resolve(
        linhas
          .filter((l) => passa(l, where))
          .sort(ordenar)
          .slice(skip, skip + take),
      ),
  );
  prisma.transaction.count.mockImplementation(({ where }: { where: Filtro }) =>
    Promise.resolve(linhas.filter((l) => passa(l, where)).length),
  );
}

const lista = (res: request.Response) => res.body as TransactionListResponseDto;
const descricoes = (res: request.Response) =>
  lista(res).data.map((l) => l.description);
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('Filtros de lançamentos (TCC-015)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;
  let linhas: Linha[];

  beforeEach(async () => {
    linhas = [
      linha('Almoço no campus', '2026-08-15'),
      linha('Mercado do mês', '2026-09-02'),
      linha('Uber para o estágio', '2026-09-10', { categoryId: TRANSPORTE }),
      linha('Salário de setembro', '2026-09-05', {
        type: 'receita',
        categoryId: SALARIO,
      }),
      linha('Desconto de 50% no MERCADO', '2026-09-20'),
      linha('Mercado_excluído', '2026-09-12', { deletedAt: new Date() }),
      linha('Mercado do outro usuário', '2026-09-03', { userId: OUTRO }),
    ];
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
      .get(`/api/transactions?${consulta}`)
      .set('Authorization', authorization);

  describe('cada filtro', () => {
    it('período, com as duas pontas inclusivas', async () => {
      const res = await get('from=2026-09-02&to=2026-09-10').expect(200);

      expect(descricoes(res)).toEqual([
        'Uber para o estágio',
        'Salário de setembro',
        'Mercado do mês',
      ]);
    });

    it('período aberto em uma das pontas', async () => {
      const desde = await get('from=2026-09-10').expect(200);
      const ate = await get('to=2026-08-31').expect(200);

      expect(descricoes(desde)).toEqual([
        'Desconto de 50% no MERCADO',
        'Uber para o estágio',
      ]);
      expect(descricoes(ate)).toEqual(['Almoço no campus']);
    });

    it('tipo', async () => {
      const res = await get('type=receita').expect(200);

      expect(descricoes(res)).toEqual(['Salário de setembro']);
    });

    it('categoria', async () => {
      const res = await get(`categoryId=${TRANSPORTE}`).expect(200);

      expect(descricoes(res)).toEqual(['Uber para o estágio']);
    });

    it('texto da descrição, sem diferenciar maiúsculas', async () => {
      const res = await get('search=mercado').expect(200);

      expect(descricoes(res)).toEqual([
        'Desconto de 50% no MERCADO',
        'Mercado do mês',
      ]);
    });

    it('apara espaços da busca', async () => {
      const res = await get('search=%20%20uber%20%20').expect(200);

      expect(descricoes(res)).toEqual(['Uber para o estágio']);
    });
  });

  describe('combinação', () => {
    it('os filtros se somam por E', async () => {
      const res = await get(
        `from=2026-09-01&to=2026-09-30&type=despesa&categoryId=${ALIMENTACAO}&search=mercado`,
      ).expect(200);

      expect(descricoes(res)).toEqual([
        'Desconto de 50% no MERCADO',
        'Mercado do mês',
      ]);
      expect(lista(res).meta.total).toBe(2);
    });

    it('categoria incompatível com o tipo devolve lista vazia, não erro', async () => {
      const res = await get(`type=receita&categoryId=${ALIMENTACAO}`).expect(
        200,
      );

      expect(lista(res).data).toEqual([]);
      expect(lista(res).meta.total).toBe(0);
    });

    it('o total e a paginação descrevem o resultado filtrado', async () => {
      const res = await get('search=mercado&pageSize=1&page=2').expect(200);

      expect(descricoes(res)).toEqual(['Mercado do mês']);
      expect(lista(res).meta).toEqual({
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      });
    });
  });

  describe('isolamento', () => {
    it('nenhum filtro alcança lançamento de outro usuário ou excluído', async () => {
      const res = await get('search=mercado&from=2026-09-01').expect(200);

      expect(descricoes(res)).not.toContain('Mercado do outro usuário');
      expect(descricoes(res)).not.toContain('Mercado_excluído');
    });

    it('o dono e a exclusão lógica ficam no where mesmo com filtros', async () => {
      await get(`type=despesa&categoryId=${ALIMENTACAO}`).expect(200);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: DONO,
            deletedAt: null,
          }) as unknown,
        }),
      );
    });

    it.each([`userId=${OUTRO}`, 'deletedAt=', 'source=assistente'])(
      'recusa %s',
      async (consulta) => {
        await get(consulta).expect(400);

        expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('curingas da busca são literais', () => {
    it('% não casa com tudo', async () => {
      const res = await get('search=%25').expect(200);

      expect(descricoes(res)).toEqual(['Desconto de 50% no MERCADO']);
    });

    it('_ não casa com qualquer caractere', async () => {
      linhas.push(linha('Mercado_centro', '2026-09-25'));

      const res = await get('search=mercado_').expect(200);

      expect(descricoes(res)).toEqual(['Mercado_centro']);
    });

    it('barra invertida é buscada como texto', async () => {
      linhas.push(linha('Pasta C:\\notas', '2026-09-25'));

      const res = await get('search=C%3A%5Cnotas').expect(200);

      expect(descricoes(res)).toEqual(['Pasta C:\\notas']);
    });

    it('texto de injeção é só texto', async () => {
      const res = await get(
        `search=${encodeURIComponent("' OR '1'='1")}`,
      ).expect(200);

      expect(lista(res).data).toEqual([]);
    });
  });

  describe('validação', () => {
    it.each([
      ['from=2026-02-30', 'from', 'Informe uma data válida.'],
      ['to=30/09/2026', 'to', 'Informe uma data válida.'],
      ['from=1999-12-31', 'from', 'Informe uma data válida.'],
      [
        'from=2026-09-30&to=2026-09-01',
        'to',
        'A data final deve ser igual ou posterior à inicial.',
      ],
      ['type=transferencia', 'type', 'O tipo deve ser receita ou despesa.'],
      [
        'type=receita&type=despesa',
        'type',
        'O tipo deve ser receita ou despesa.',
      ],
      [
        `categoryId=${encodeURIComponent("1' OR '1'='1")}`,
        'categoryId',
        'Categoria inválida.',
      ],
      [
        `search=${'x'.repeat(101)}`,
        'search',
        'A busca deve ter no máximo 100 caracteres.',
      ],
      ['search=a%00b', 'search', 'A busca contém caracteres inválidos.'],
      ['search=a&search=b', 'search', 'A busca deve ser um texto.'],
    ])('recusa %s', async (consulta, campo, mensagem) => {
      const res = await get(consulta).expect(400);

      expect(erro(res).fieldErrors?.[campo]).toContain(mensagem);
      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    });

    it('aceita período de um dia só', async () => {
      const res = await get('from=2026-09-10&to=2026-09-10').expect(200);

      expect(descricoes(res)).toEqual(['Uber para o estágio']);
    });

    it('busca só com espaços não filtra', async () => {
      const res = await get('search=%20%20%20').expect(200);

      expect(lista(res).meta.total).toBe(5);
    });
  });
});
