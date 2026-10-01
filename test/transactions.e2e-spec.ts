import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { TransactionResponseDto } from './../src/transactions/dto/transaction-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const USUARIO_DO_TOKEN = '0199a1b2-c3d4-7000-8000-0000000000aa';
const CATEGORIA = '0199a1b2-c3d4-7000-8000-000000000002';

const VALIDO = {
  type: 'despesa',
  amount: '35.90',
  categoryId: CATEGORIA,
  date: '2026-09-21',
  description: 'Almoço no restaurante do campus',
};

const LINHA = {
  id: '0199a1b2-c3d4-7000-8000-0000000000f1',
  userId: USUARIO_DO_TOKEN,
  categoryId: CATEGORIA,
  type: 'despesa',
  amount: new Prisma.Decimal('35.9'),
  date: new Date('2026-09-21T00:00:00.000Z'),
  description: VALIDO.description,
  source: 'formulario',
  createdAt: new Date('2026-09-21T15:00:00.000Z'),
  updatedAt: new Date('2026-09-21T15:00:00.000Z'),
  deletedAt: null,
  category: { name: 'Alimentação' },
};

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('POST /api/transactions (TCC-012)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;

  beforeEach(async () => {
    prisma = createPrismaStub();
    prisma.transaction.create.mockResolvedValue(LINHA);
    app = await createTestApp(prisma);
    authorization = await authenticateFakeUser(prisma, app);
  });

  afterEach(async () => {
    await app.close();
  });

  const enviar = (corpo: object) =>
    request(app.getHttpServer())
      .post('/api/transactions')
      .set('Authorization', authorization)
      .send(corpo);

  function gravado(): Record<string, unknown> {
    const [args] = prisma.transaction.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];

    return args.data;
  }

  describe('acesso', () => {
    it('sem autenticação responde 401 e nada é gravado', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .send(VALIDO)
        .expect(401);

      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('lançamento válido', () => {
    it('cria e responde 201 com o contrato da API', async () => {
      const res = await enviar(VALIDO).expect(201);

      expect(res.body as TransactionResponseDto).toEqual({
        id: LINHA.id,
        type: 'despesa',
        amount: '35.90',
        date: '2026-09-21',
        description: VALIDO.description,
        categoryId: CATEGORIA,
        categoryName: 'Alimentação',
        source: 'formulario',
        createdAt: '2026-09-21T15:00:00.000Z',
        updatedAt: '2026-09-21T15:00:00.000Z',
      });
    });

    it('vincula ao usuário do token e marca a origem como formulário', async () => {
      await enviar(VALIDO).expect(201);

      expect(gravado()).toMatchObject({
        userId: USUARIO_DO_TOKEN,
        source: 'formulario',
        amount: '35.90',
      });
    });

    it('grava a data civil como meia-noite UTC, sem deslocar o dia', async () => {
      await enviar({ ...VALIDO, date: '2026-12-31' }).expect(201);

      expect(gravado().date).toEqual(new Date('2026-12-31T00:00:00.000Z'));
    });

    it('aceita receita e valor mínimo', async () => {
      await enviar({ ...VALIDO, type: 'receita', amount: '0.01' }).expect(201);
    });

    it('apara espaços da descrição', async () => {
      await enviar({ ...VALIDO, description: '   Almoço   ' }).expect(201);

      expect(gravado().description).toBe('Almoço');
    });

    it('não devolve o dono nem a exclusão lógica', async () => {
      const res = await enviar(VALIDO).expect(201);

      expect(res.body).not.toHaveProperty('userId');
      expect(res.body).not.toHaveProperty('deletedAt');
    });

    it('consulta a categoria com o tipo do lançamento', async () => {
      await enviar({ ...VALIDO, type: 'receita' }).expect(201);

      expect(prisma.category.count).toHaveBeenCalledWith({
        where: { id: CATEGORIA, type: 'receita', isActive: true },
      });
    });
  });

  describe('campos que o cliente não controla', () => {
    it.each([
      ['userId', '0199a1b2-c3d4-7000-8000-00000000000b'],
      ['source', 'assistente'],
      ['id', '0199a1b2-c3d4-7000-8000-0000000000f9'],
      ['deletedAt', '2026-01-01T00:00:00.000Z'],
      ['createdAt', '2000-01-01T00:00:00.000Z'],
    ])('recusa `%s` no corpo', async (campo, valor) => {
      const res = await enviar({ ...VALIDO, [campo]: valor }).expect(400);

      expect(erro(res).fieldErrors).toHaveProperty(campo);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('valor', () => {
    it.each([
      ['0', 'O valor deve ser maior que zero.'],
      ['-10', 'O valor deve ser maior que zero.'],
      ['10.999', 'Use no máximo duas casas decimais.'],
      ['10000000000', 'O valor deve ser no máximo 9.999.999.999,99.'],
      ['abc', 'Informe o valor.'],
      ['', 'Informe o valor.'],
    ])('recusa %j', async (amount, mensagem) => {
      const res = await enviar({ ...VALIDO, amount }).expect(400);

      expect(erro(res).fieldErrors?.amount).toEqual([mensagem]);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('recusa número JSON: só texto decimal', async () => {
      const res = await enviar({ ...VALIDO, amount: 35.9 }).expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('amount');
    });

    it('recusa valor ausente', async () => {
      const { amount, ...semValor } = VALIDO;
      void amount;

      const res = await enviar(semValor).expect(400);

      expect(erro(res).fieldErrors?.amount).toEqual(['Informe o valor.']);
    });
  });

  describe('data', () => {
    it.each(['2026-02-30', '2026-13-01', '21/09/2026', '2026-09-21T10:00:00Z'])(
      'recusa %s',
      async (date) => {
        const res = await enviar({ ...VALIDO, date }).expect(400);

        expect(erro(res).fieldErrors?.date).toEqual([
          'Informe uma data válida.',
        ]);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('tipo, categoria e descrição', () => {
    it('recusa tipo fora do domínio', async () => {
      const res = await enviar({ ...VALIDO, type: 'transferencia' }).expect(
        400,
      );

      expect(erro(res).fieldErrors?.type).toEqual([
        'O tipo deve ser receita ou despesa.',
      ]);
    });

    it('recusa categoria que não é UUID sem consultar o banco', async () => {
      const res = await enviar({
        ...VALIDO,
        categoryId: "1' OR '1'='1",
      }).expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('categoryId');
      expect(prisma.category.count).not.toHaveBeenCalled();
    });

    it('recusa categoria incompatível, inativa ou inexistente com a mesma resposta', async () => {
      prisma.category.count.mockResolvedValue(0);

      const res = await enviar(VALIDO).expect(400);

      expect(erro(res).fieldErrors?.categoryId).toEqual([
        'A categoria precisa ser compatível com o tipo do lançamento.',
      ]);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it.each([
      ['ab', 'Descreva o lançamento com pelo menos 3 caracteres.'],
      ['x'.repeat(141), 'A descrição deve ter no máximo 140 caracteres.'],
      ['Almo\u0000ço', 'A descrição contém caracteres inválidos.'],
      ['Almo\u001bço', 'A descrição contém caracteres inválidos.'],
    ])('recusa descrição %#', async (description, mensagem) => {
      const res = await enviar({ ...VALIDO, description }).expect(400);

      expect(erro(res).fieldErrors?.description).toContain(mensagem);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('a descrição é opcional: ausente é gravada como nula', async () => {
      const { description, ...semDescricao } = VALIDO;
      void description;
      prisma.transaction.create.mockResolvedValue({
        ...LINHA,
        description: null,
      });

      const res = await enviar(semDescricao).expect(201);

      expect(gravado().description).toBeNull();
      expect((res.body as TransactionResponseDto).description).toBeNull();
    });

    it.each([null, '', '    '])(
      'descrição %j é gravada como nula',
      async (description) => {
        await enviar({ ...VALIDO, description }).expect(201);

        expect(gravado().description).toBeNull();
      },
    );

    it('descrição preenchida continua exigindo pelo menos 3 caracteres', async () => {
      const res = await enviar({ ...VALIDO, description: ' ab ' }).expect(400);

      expect(erro(res).fieldErrors?.description).toContain(
        'Descreva o lançamento com pelo menos 3 caracteres.',
      );
    });

    it('aceita quebra de linha na descrição', async () => {
      await enviar({ ...VALIDO, description: 'Mercado\nfeira' }).expect(201);
    });

    it('trata texto de injeção como dado comum', async () => {
      await enviar({
        ...VALIDO,
        description: "'; DROP TABLE transactions; --",
      }).expect(201);

      expect(gravado().description).toBe("'; DROP TABLE transactions; --");
    });

    it('lista todos os campos inválidos de uma vez', async () => {
      const res = await enviar({
        type: 'x',
        amount: '0',
        categoryId: 'nao-uuid',
        date: '2026-02-30',
        description: 'ab',
      }).expect(400);

      expect(Object.keys(erro(res).fieldErrors ?? {}).sort()).toEqual([
        'amount',
        'categoryId',
        'date',
        'description',
        'type',
      ]);
    });
  });
});
