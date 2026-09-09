import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';

/**
 * Prefixo global das rotas.
 *
 * Estes testes existem porque o prefixo mora em `configure-app.ts`, e nao no
 * `main.ts`: se alguem o mover de volta para o bootstrap, a suite volta a
 * exercitar rotas sem prefixo e passa a provar o oposto do que roda.
 */
describe('Prefixo global da API', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;

  beforeEach(async () => {
    prisma = createPrismaStub();
    app = await createTestApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  it('a raiz nao serve mais nada e responde no formato de erro da API', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(404);
    const body = res.body as ApiErrorBody;

    expect(body.statusCode).toBe(404);
    expect(body.path).toBe('/');
    expect(typeof body.timestamp).toBe('string');
  });

  it('rota de dominio sem o prefixo responde 404', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
    await request(app.getHttpServer()).get('/categories').expect(404);
  });

  it('as rotas respondem sob /api', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/categories').expect(200);
  });
});
