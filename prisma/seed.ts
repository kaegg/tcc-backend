/**
 * Dados controlados de desenvolvimento (TCC-005).
 *
 * Roda por `prisma migrate reset` e por `npm run prisma:seed`. executar duas vezes seguidas nao duplica nada.
 *
 * Sempre semeia as categorias do sistema. O usuario e os lancamentos de demonstracao so entram com
 * `SEED_DEMO=true`, para que um `reset` acidental em outro ambiente nao crie conta nenhuma.
 */

import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  TransactionType,
  TransactionSource,
} from '../src/generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

const SYSTEM_CATEGORIES: { name: string; type: TransactionType }[] = [
  { name: 'Alimentação', type: 'despesa' },
  { name: 'Transporte', type: 'despesa' },
  { name: 'Moradia', type: 'despesa' },
  { name: 'Saúde', type: 'despesa' },
  { name: 'Educação', type: 'despesa' },
  { name: 'Lazer', type: 'despesa' },
  { name: 'Assinaturas', type: 'despesa' },
  { name: 'Salário', type: 'receita' },
  { name: 'Freelance', type: 'receita' },
  { name: 'Investimentos', type: 'receita' },
];

/**
 * Lancamentos de demonstracao, reproduzindo os de `demo-data.ts`.
 */
const DEMO_TRANSACTIONS: {
  category: string;
  type: TransactionType;
  amount: string;
  date: string;
  description: string;
  source: TransactionSource;
}[] = [
  {
    category: 'Alimentação',
    type: 'despesa',
    amount: '35.00',
    date: '2026-08-16',
    description: 'Almoço no restaurante do campus',
    source: 'assistente',
  },
  {
    category: 'Assinaturas',
    type: 'despesa',
    amount: '22.90',
    date: '2026-08-15',
    description: 'Assinatura de streaming',
    source: 'formulario',
  },
  {
    category: 'Freelance',
    type: 'receita',
    amount: '1200.00',
    date: '2026-08-14',
    description: 'Projeto freelance - landing page',
    source: 'formulario',
  },
  {
    category: 'Alimentação',
    type: 'despesa',
    amount: '89.40',
    date: '2026-08-13',
    description: 'Compras no mercado',
    source: 'assistente',
  },
  {
    category: 'Transporte',
    type: 'despesa',
    amount: '160.00',
    date: '2026-08-12',
    description: 'Recarga do cartão de transporte',
    source: 'formulario',
  },
  {
    category: 'Moradia',
    type: 'despesa',
    amount: '1450.00',
    date: '2026-08-10',
    description: 'Aluguel',
    source: 'formulario',
  },
  {
    category: 'Salário',
    type: 'receita',
    amount: '4200.00',
    date: '2026-08-05',
    description: 'Salário',
    source: 'formulario',
  },
  {
    category: 'Saúde',
    type: 'despesa',
    amount: '74.50',
    date: '2026-08-04',
    description: 'Consulta odontológica',
    source: 'assistente',
  },
  {
    category: 'Lazer',
    type: 'despesa',
    amount: '58.00',
    date: '2026-08-03',
    description: 'Cinema com amigos',
    source: 'assistente',
  },
  {
    category: 'Educação',
    type: 'despesa',
    amount: '320.00',
    date: '2026-08-02',
    description: 'Mensalidade do curso de inglês',
    source: 'formulario',
  },
  {
    category: 'Investimentos',
    type: 'receita',
    amount: '180.00',
    date: '2026-08-01',
    description: 'Rendimento da reserva de emergência',
    source: 'formulario',
  },
  {
    category: 'Transporte',
    type: 'despesa',
    amount: '42.80',
    date: '2026-07-30',
    description: 'Aplicativo de transporte',
    source: 'assistente',
  },
  {
    category: 'Saúde',
    type: 'despesa',
    amount: '118.60',
    date: '2026-07-28',
    description: 'Farmácia',
    source: 'formulario',
  },
  {
    category: 'Moradia',
    type: 'despesa',
    amount: '1450.00',
    date: '2026-07-10',
    description: 'Aluguel',
    source: 'formulario',
  },
  {
    category: 'Salário',
    type: 'receita',
    amount: '4200.00',
    date: '2026-07-05',
    description: 'Salário',
    source: 'formulario',
  },
];

async function seedSystemCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const category of SYSTEM_CATEGORIES) {
    const saved = await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: { isActive: true },
      create: category,
    });
    ids.set(`${category.type}:${category.name}`, saved.id);
  }

  console.log(`Categorias do sistema: ${ids.size} disponiveis.`);
  return ids;
}

async function seedDemoData(categoryIds: Map<string, string>): Promise<void> {
  const email = (process.env.SEED_DEMO_EMAIL ?? 'demo@intellifinance.local')
    .trim()
    .toLowerCase();
  const password = process.env.SEED_DEMO_PASSWORD;

  // Senha nunca fica embutida no codigo. Sem a variavel, o seed de demonstracao
  // aborta em vez de criar uma conta com senha previsivel.
  if (!password) {
    throw new Error(
      'SEED_DEMO=true exige SEED_DEMO_PASSWORD. Defina uma senha no .env ou ' +
        'remova SEED_DEMO para semear apenas as categorias.',
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: process.env.SEED_DEMO_NAME ?? 'Usuário de demonstração',
      email,
      passwordHash: await argon2.hash(password),
    },
  });

  // Idempotencia: o seed nao tem chave natural para o lancamento, entao os
  // lancamentos de demonstracao deste usuario sao refeitos a cada execucao.
  await prisma.transaction.deleteMany({ where: { userId: user.id } });

  await prisma.transaction.createMany({
    data: DEMO_TRANSACTIONS.map((item) => {
      const categoryId = categoryIds.get(`${item.type}:${item.category}`);
      if (!categoryId) {
        throw new Error(
          `Categoria de demonstracao inexistente: ${item.category}`,
        );
      }

      return {
        userId: user.id,
        categoryId,
        type: item.type,
        amount: item.amount,
        date: new Date(`${item.date}T00:00:00Z`),
        description: item.description,
        source: item.source,
      };
    }),
  });

  console.log(
    `Dados de demonstracao: usuario ${email} com ${DEMO_TRANSACTIONS.length} lancamentos.`,
  );
}

async function main(): Promise<void> {
  const categoryIds = await seedSystemCategories();

  if (process.env.SEED_DEMO === 'true') {
    await seedDemoData(categoryIds);
  } else {
    console.log(
      'SEED_DEMO nao esta em "true": usuario e lancamentos de demonstracao nao foram criados.',
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
