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
const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';
const TRANSPORTE = '0199a1b2-c3d4-7000-8000-00000000c002';
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';

const NOMES: Record<string, string> = {
  [ALIMENTACAO]: 'Alimentação',
  [TRANSPORTE]: 'Transporte',
  [SALARIO]: 'Salário',
};

const INSTANTE_DA_EDICAO = new Date('2026-09-24T12:00:00.000Z');

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
}

let contador = 0;

function linha(sobrescrever: Partial<Linha> = {}): Linha {
  contador += 1;
  const n = String(contador).padStart(12, '0');

  return {
    id: `0199a1b2-c3d4-7000-8000-${n}`,
    userId: DONO,
    categoryId: ALIMENTACAO,
    type: 'despesa',
    amount: new Prisma.Decimal('35.9'),
    date: new Date('2026-09-01T00:00:00.000Z'),
    description: 'Almoço no campus',
    source: 'formulario',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...sobrescrever,
  };
}

/**
 * Tabela em memória que aplica o `where` recebido e grava o `data` na linha.
 * Um dublê de retorno fixo não provaria o isolamento: se o service esquecesse
 * o dono ou a exclusão lógica no filtro da escrita, a linha de outro usuário
 * seria alterada aqui e os testes falhariam.
 */
function instalarTabela(prisma: PrismaStub, linhas: Linha[]) {
  const passa = (l: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => l[k as keyof Linha] === v);

  const comCategoria = (l: Linha) => ({
    ...l,
    category: { name: NOMES[l.categoryId] },
  });

  prisma.transaction.findFirst.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) => {
      const achada = linhas.find((l) => passa(l, where));
      return Promise.resolve(achada ? comCategoria(achada) : null);
    },
  );
  prisma.transaction.findMany.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(linhas.filter((l) => passa(l, where)).map(comCategoria)),
  );
  prisma.transaction.count.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(linhas.filter((l) => passa(l, where)).length),
  );
  prisma.transaction.updateMany.mockImplementation(
    ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const alvo = linhas.filter((l) => passa(l, where));
      for (const l of alvo) {
        const { amount, ...resto } = data;
        Object.assign(l, resto, { updatedAt: INSTANTE_DA_EDICAO });
        if (amount !== undefined) {
          l.amount = new Prisma.Decimal(amount as string);
        }
      }
      return Promise.resolve({ count: alvo.length });
    },
  );
}

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('Edição e exclusão de lançamentos (TCC-014)', () => {
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

  const server = () => request(app.getHttpServer());

  const editar = (id: string, corpo: object) =>
    server()
      .patch(`/api/transactions/${id}`)
      .set('Authorization', authorization)
      .send(corpo);

  const excluir = (id: string) =>
    server()
      .delete(`/api/transactions/${id}`)
      .set('Authorization', authorization);

  const ler = (url: string) =>
    server().get(url).set('Authorization', authorization);

  describe('PATCH /api/transactions/:id', () => {
    it('exige autenticação e nada é gravado', async () => {
      const item = linha();
      linhas.push(item);

      await server()
        .patch(`/api/transactions/${item.id}`)
        .send({ amount: '1.00' })
        .expect(401);

      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    });

    it('altera todos os campos e devolve o lançamento atualizado', async () => {
      const item = linha();
      linhas.push(item);

      const res = await editar(item.id, {
        type: 'receita',
        amount: '1500.00',
        categoryId: SALARIO,
        date: '2026-09-05',
        description: 'Salário de setembro',
      }).expect(200);

      expect(res.body as TransactionResponseDto).toEqual({
        id: item.id,
        type: 'receita',
        amount: '1500.00',
        date: '2026-09-05',
        description: 'Salário de setembro',
        categoryId: SALARIO,
        categoryName: 'Salário',
        source: 'formulario',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: INSTANTE_DA_EDICAO.toISOString(),
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('altera só o que veio no corpo e preserva o restante', async () => {
      const item = linha();
      linhas.push(item);

      const res = await editar(item.id, { amount: '42.00' }).expect(200);

      expect(res.body as TransactionResponseDto).toMatchObject({
        amount: '42.00',
        type: 'despesa',
        categoryId: ALIMENTACAO,
        date: '2026-09-01',
        description: 'Almoço no campus',
      });
    });

    it('preserva a origem do lançamento criado pelo assistente', async () => {
      const item = linha({ source: 'assistente' });
      linhas.push(item);

      const res = await editar(item.id, { description: 'Ajustado' }).expect(
        200,
      );

      expect((res.body as TransactionResponseDto).source).toBe('assistente');
    });

    it('grava a data civil como meia-noite UTC e apara a descrição', async () => {
      const item = linha();
      linhas.push(item);

      await editar(item.id, {
        date: '2026-12-31',
        description: '   Mercado   ',
      }).expect(200);

      expect(item.date).toEqual(new Date('2026-12-31T00:00:00.000Z'));
      expect(item.description).toBe('Mercado');
    });

    it('filtra a escrita pelo dono do token e pela exclusão lógica', async () => {
      const item = linha();
      linhas.push(item);

      await editar(item.id, { amount: '1.00' }).expect(200);

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: item.id, userId: DONO, deletedAt: null },
        }),
      );
    });

    describe('mesmas validações do cadastro', () => {
      it.each([
        ['amount', '0', 'O valor deve ser maior que zero.'],
        ['amount', '-10', 'O valor deve ser maior que zero.'],
        ['amount', '10.999', 'Use no máximo duas casas decimais.'],
        [
          'amount',
          '10000000000',
          'O valor deve ser no máximo 9.999.999.999,99.',
        ],
        ['amount', 35.9, 'Informe o valor.'],
        ['date', '2026-02-30', 'Informe uma data válida.'],
        ['date', '21/09/2026', 'Informe uma data válida.'],
        ['type', 'transferencia', 'O tipo deve ser receita ou despesa.'],
        ['categoryId', "1' OR '1'='1", 'Selecione uma categoria.'],
        [
          'description',
          'ab',
          'Descreva o lançamento com pelo menos 3 caracteres.',
        ],
        [
          'description',
          'x'.repeat(141),
          'A descrição deve ter no máximo 140 caracteres.',
        ],
        [
          'description',
          'Almo\u0000ço',
          'A descrição contém caracteres inválidos.',
        ],
      ])('recusa %s = %j', async (campo, valor, mensagem) => {
        const item = linha();
        linhas.push(item);

        const res = await editar(item.id, { [campo]: valor }).expect(400);

        expect(erro(res).fieldErrors?.[campo]).toContain(mensagem);
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      });

      it.each(['type', 'amount', 'categoryId', 'date', 'description'])(
        'recusa %s nulo em vez de apagar o campo',
        async (campo) => {
          const item = linha();
          linhas.push(item);

          const res = await editar(item.id, { [campo]: null }).expect(400);

          expect(erro(res).fieldErrors).toHaveProperty(campo);
          expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
        },
      );

      it('recusa corpo vazio', async () => {
        const item = linha();
        linhas.push(item);

        const res = await editar(item.id, {}).expect(400);

        expect(erro(res).message).toBe(
          'Informe ao menos um campo para alterar.',
        );
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      });

      it('recusa categoria incompatível, inativa ou inexistente', async () => {
        const item = linha();
        linhas.push(item);
        prisma.category.count.mockResolvedValue(0);

        const res = await editar(item.id, { categoryId: SALARIO }).expect(400);

        expect(erro(res).fieldErrors?.categoryId).toEqual([
          'A categoria precisa ser compatível com o tipo do lançamento.',
        ]);
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      });

      it('confere a categoria atual contra o tipo novo quando só o tipo muda', async () => {
        const item = linha();
        linhas.push(item);
        prisma.category.count.mockResolvedValue(0);

        await editar(item.id, { type: 'receita' }).expect(400);

        expect(prisma.category.count).toHaveBeenCalledWith({
          where: { id: ALIMENTACAO, type: 'receita', isActive: true },
        });
        expect(item.type).toBe('despesa');
      });

      it('trata texto de injeção como dado comum', async () => {
        const item = linha();
        linhas.push(item);

        await editar(item.id, {
          description: "'; DROP TABLE transactions; --",
        }).expect(200);

        expect(item.description).toBe("'; DROP TABLE transactions; --");
      });
    });

    describe('campos que o cliente não controla', () => {
      it.each([
        ['userId', OUTRO],
        ['source', 'assistente'],
        ['id', '0199a1b2-c3d4-7000-8000-0000000000f9'],
        ['deletedAt', null],
        ['createdAt', '2000-01-01T00:00:00.000Z'],
        ['updatedAt', '2000-01-01T00:00:00.000Z'],
      ])('recusa `%s` no corpo', async (campo, valor) => {
        const item = linha();
        linhas.push(item);

        const res = await editar(item.id, {
          amount: '1.00',
          [campo]: valor,
        }).expect(400);

        expect(erro(res).fieldErrors).toHaveProperty(campo);
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('posse', () => {
      it('lançamento de outro usuário responde 404 e continua intacto', async () => {
        const alheio = linha({ userId: OUTRO });
        linhas.push(alheio);

        const res = await editar(alheio.id, { amount: '1.00' }).expect(404);

        expect(erro(res).message).toBe('Lançamento não encontrado.');
        expect(alheio.amount.toFixed(2)).toBe('35.90');
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      });

      it('responde igual para o inexistente e para o de outro usuário', async () => {
        const alheio = linha({ userId: OUTRO });
        linhas.push(alheio);

        const doOutro = await editar(alheio.id, { amount: '1.00' });
        const inexistente = await editar(
          '0199a1b2-c3d4-7000-8000-ffffffffffff',
          { amount: '1.00' },
        );

        expect(doOutro.status).toBe(404);
        expect(inexistente.status).toBe(404);
        expect(erro(inexistente).message).toBe(erro(doOutro).message);
      });

      it('lançamento excluído não é editado', async () => {
        const excluido = linha({ deletedAt: new Date('2026-09-02T00:00:00Z') });
        linhas.push(excluido);

        await editar(excluido.id, { amount: '1.00' }).expect(404);

        expect(excluido.amount.toFixed(2)).toBe('35.90');
      });

      it('excluído entre a leitura e a escrita responde 404', async () => {
        const item = linha();
        linhas.push(item);
        prisma.transaction.updateMany.mockResolvedValueOnce({ count: 0 });

        await editar(item.id, { amount: '1.00' }).expect(404);
      });

      it.each(['abc', "1' OR '1'='1", '00000000-0000-0000-0000-00000000000'])(
        'id malformado %j responde 404 sem consultar o banco',
        async (id) => {
          const res = await editar(encodeURIComponent(id), {
            amount: '1.00',
          }).expect(404);

          expect(erro(res).message).toBe('Lançamento não encontrado.');
          expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
          expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('DELETE /api/transactions/:id', () => {
    it('exige autenticação e nada é excluído', async () => {
      const item = linha();
      linhas.push(item);

      await server().delete(`/api/transactions/${item.id}`).expect(401);

      expect(item.deletedAt).toBeNull();
    });

    it('exclui logicamente e responde 204 sem corpo', async () => {
      const item = linha();
      linhas.push(item);

      const res = await excluir(item.id).expect(204);

      expect(res.text).toBe('');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(linhas).toContain(item);
      expect(item.deletedAt).toBeInstanceOf(Date);
    });

    it('o excluído some da listagem e do detalhe', async () => {
      const item = linha({ description: 'Vai sumir' });
      linhas.push(item, linha({ description: 'Fica' }));

      await excluir(item.id).expect(204);

      const lista = await ler('/api/transactions').expect(200);
      expect(
        (lista.body as TransactionListResponseDto).data.map(
          (l) => l.description,
        ),
      ).toEqual(['Fica']);
      expect((lista.body as TransactionListResponseDto).meta.total).toBe(1);
      await ler(`/api/transactions/${item.id}`).expect(404);
    });

    it('excluir de novo responde 404', async () => {
      const item = linha();
      linhas.push(item);

      await excluir(item.id).expect(204);
      const primeiraExclusao = item.deletedAt;
      await excluir(item.id).expect(404);

      expect(item.deletedAt).toBe(primeiraExclusao);
    });

    it('lançamento de outro usuário responde 404 e não é excluído', async () => {
      const alheio = linha({ userId: OUTRO });
      linhas.push(alheio);

      const res = await excluir(alheio.id).expect(404);

      expect(erro(res).message).toBe('Lançamento não encontrado.');
      expect(alheio.deletedAt).toBeNull();
    });

    it('filtra pela posse e pela exclusão lógica no próprio UPDATE', async () => {
      const item = linha();
      linhas.push(item);

      await excluir(item.id).expect(204);

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { id: item.id, userId: DONO, deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });

    it.each(['abc', "1' OR '1'='1"])(
      'id malformado %j responde 404 sem consultar o banco',
      async (id) => {
        await excluir(encodeURIComponent(id)).expect(404);

        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
