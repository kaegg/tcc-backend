import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Roda contra `DATABASE_URL_TEST`, um banco separado do de desenvolvimento,
 * porque apaga o que cria. Sem a variavel o arquivo inteiro e pulado, para que
 * `npm run test:e2e` continue passando em quem clonou o repositorio sem banco.
 *
 *   createdb -U postgres intellifinance_test
 *   npx prisma migrate deploy   # com DATABASE_URL apontando para o banco de teste
 */

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Restricoes de integridade do esquema', () => {
  let prisma: PrismaClient;
  let userId: string;
  let despesaId: string;
  let receitaId: string;

  /** Marca as linhas criadas aqui, para a limpeza nao tocar em mais nada. */
  const TEST_EMAIL = 'schema-constraints@teste.local';
  const TEST_CATEGORY_PREFIX = 'ZZ Teste';

  async function cleanup(): Promise<void> {
    await prisma.transaction.deleteMany({
      where: { user: { email: TEST_EMAIL } },
    });
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.category.deleteMany({
      where: { name: { startsWith: TEST_CATEGORY_PREFIX } },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
    });

    await cleanup();

    const user = await prisma.user.create({
      data: {
        name: 'Participante de teste',
        email: TEST_EMAIL,
        passwordHash: 'hash-de-teste-nao-e-uma-senha',
      },
    });
    userId = user.id;

    const despesa = await prisma.category.create({
      data: { name: `${TEST_CATEGORY_PREFIX} Despesa`, type: 'despesa' },
    });
    despesaId = despesa.id;

    const receita = await prisma.category.create({
      data: { name: `${TEST_CATEGORY_PREFIX} Receita`, type: 'receita' },
    });
    receitaId = receita.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup();
    await prisma.$disconnect();
  });

  /** Lancamento valido, servindo de base para cada variacao invalida. */
  const validTransaction = () => ({
    userId,
    categoryId: despesaId,
    type: 'despesa' as const,
    amount: '35.00',
    date: new Date('2026-08-16T00:00:00Z'),
    description: 'Almoço no restaurante do campus',
  });

  it('aceita um lancamento valido', async () => {
    const created = await prisma.transaction.create({
      data: validTransaction(),
    });

    expect(Number(created.amount)).toBe(35);
    expect(created.source).toBe('formulario');
    expect(created.deletedAt).toBeNull();

    await prisma.transaction.delete({ where: { id: created.id } });
  });

  describe('RN02 - categoria compativel com o tipo do lancamento', () => {
    it('recusa despesa apontando para categoria de receita', async () => {
      await expect(
        prisma.transaction.create({
          data: { ...validTransaction(), categoryId: receitaId },
        }),
      ).rejects.toThrow();
    });

    it('recusa receita apontando para categoria de despesa', async () => {
      await expect(
        prisma.transaction.create({
          data: {
            ...validTransaction(),
            type: 'receita',
            categoryId: despesaId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('RN03 - valor maior que zero', () => {
    it.each([['0.00'], ['-10.00']])('recusa valor %s', async (amount) => {
      await expect(
        prisma.transaction.create({ data: { ...validTransaction(), amount } }),
      ).rejects.toThrow();
    });
  });

  describe('RNF09 - campos obrigatorios e datas coerentes', () => {
    it('recusa descricao em branco', async () => {
      await expect(
        prisma.transaction.create({
          data: { ...validTransaction(), description: '   ' },
        }),
      ).rejects.toThrow();
    });

    // Data valida em JS, mas fora da faixa do CHECK: quem recusa e o banco.
    it.each([['1800-01-01'], ['2200-01-01']])(
      'recusa data fora da faixa plausivel (%s)',
      async (date) => {
        await expect(
          prisma.transaction.create({
            data: {
              ...validTransaction(),
              date: new Date(`${date}T00:00:00Z`),
            },
          }),
        ).rejects.toThrow();
      },
    );
  });

  describe('Unicidade de e-mail sem diferenciar maiusculas', () => {
    it('recusa e-mail com maiuscula, porque a coluna so aceita minusculo', async () => {
      await expect(
        prisma.user.create({
          data: {
            name: 'Outro participante',
            email: TEST_EMAIL.toUpperCase(),
            passwordHash: 'hash-de-teste-nao-e-uma-senha',
          },
        }),
      ).rejects.toThrow();
    });

    it('recusa o mesmo e-mail duas vezes', async () => {
      await expect(
        prisma.user.create({
          data: {
            name: 'Outro participante',
            email: TEST_EMAIL,
            passwordHash: 'hash-de-teste-nao-e-uma-senha',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Categoria em uso nao e apagada', () => {
    it('recusa apagar categoria referenciada por um lancamento', async () => {
      const created = await prisma.transaction.create({
        data: validTransaction(),
      });

      await expect(
        prisma.category.delete({ where: { id: despesaId } }),
      ).rejects.toThrow();

      await prisma.transaction.delete({ where: { id: created.id } });
    });
  });

  describe('RN09 - exclusao logica', () => {
    it('mantem a linha no banco e permite filtrar pelos ativos', async () => {
      const created = await prisma.transaction.create({
        data: validTransaction(),
      });

      await prisma.transaction.update({
        where: { id: created.id },
        data: { deletedAt: new Date() },
      });

      const stillStored = await prisma.transaction.findUnique({
        where: { id: created.id },
      });
      expect(stillStored?.deletedAt).not.toBeNull();

      const activeOnly = await prisma.transaction.findMany({
        where: { userId, deletedAt: null },
      });
      expect(activeOnly.map((t) => t.id)).not.toContain(created.id);

      await prisma.transaction.delete({ where: { id: created.id } });
    });
  });

  describe('RNF08 - metrica de uso sem vinculo com o usuario', () => {
    it('grava a metrica sem exigir nenhum dado pessoal', async () => {
      const metric = await prisma.usageMetric.create({
        data: {
          participantCode: 'P99',
          sessionCode: 'S-teste',
          mode: 'assistente',
          taskCode: 'T1',
          startedAt: new Date('2026-10-01T14:00:00Z'),
          finishedAt: new Date('2026-10-01T14:02:30Z'),
          durationMs: 150_000,
          interactionCount: 3,
          outcome: 'sucesso',
        },
      });

      expect(metric.errorCount).toBe(0);
      expect(Object.keys(metric)).not.toContain('userId');

      await prisma.usageMetric.delete({ where: { id: metric.id } });
    });

    it('recusa tarefa terminando antes de comecar', async () => {
      await expect(
        prisma.usageMetric.create({
          data: {
            participantCode: 'P99',
            sessionCode: 'S-teste',
            mode: 'formulario',
            taskCode: 'T2',
            startedAt: new Date('2026-10-01T14:05:00Z'),
            finishedAt: new Date('2026-10-01T14:00:00Z'),
          },
        }),
      ).rejects.toThrow();
    });
  });
});
