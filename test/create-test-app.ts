import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Dublê do PrismaService.
 *
 * Substituir o provider inteiro impede que o construtor real rode, e com ele a
 * leitura de `DATABASE_URL` e a conexao com o banco. E o que mantem
 * `npm run test:e2e` verde em quem clonou o repositorio sem PostgreSQL — a
 * mesma decisao ja tomada em `schema-constraints.e2e-spec.ts`.
 */
export type PrismaStub = {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  category: { findMany: jest.Mock; count: jest.Mock };
  transaction: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
    groupBy: jest.Mock;
  };
  user: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  session: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  onModuleInit: jest.Mock;
  onModuleDestroy: jest.Mock;
};

export function createPrismaStub(): PrismaStub {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
    },
    transaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Segredo so de teste: o CI nao tem `.env`, e sem segredo forte a aplicacao
 * recusa subir (de proposito).
 */
process.env.JWT_SECRET ??= 'segredo-somente-para-testes-e2e-0123456789';

/**
 * Monta a aplicacao do jeito que ela roda de verdade.
 *
 * `bodyParser: false` mais `configureApp` reproduzem exatamente o que o
 * `main.ts` faz. Sem isso, o prefixo global e o limite de corpo nao existiriam
 * no teste e a suite passaria provando o oposto do que o processo real serve.
 */
export async function createTestApp(
  prisma: PrismaStub,
): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });

  configureApp(app);
  await app.init();

  return app;
}
