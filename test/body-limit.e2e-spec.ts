import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { createPrismaStub, createTestApp } from './create-test-app';

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

const texto = (body: ApiErrorBody): string =>
  Array.isArray(body.message) ? body.message.join(' ') : body.message;

/**
 * Limite de corpo e falhas do body-parser (TCC-006).
 *
 * O parser roda como middleware, antes do roteamento, entao qualquer rota serve
 * para exercita-lo — inclusive uma que nao aceita POST.
 *
 * Estes casos cobrem um defeito que existia antes desta issue: erros do
 * body-parser sao `http-errors`, nao `HttpException`, e por isso caiam no ramo
 * generico do filtro e viravam 500.
 */
describe('Limite de corpo e erros do body-parser (TCC-006)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp(createPrismaStub());
  });

  afterEach(async () => {
    await app.close();
  });

  it('recusa corpo acima do limite com 413, e nao com 500', async () => {
    const gigante = JSON.stringify({ descricao: 'x'.repeat(200 * 1024) });

    const res = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Content-Type', 'application/json')
      .send(gigante);

    expect(res.status).toBe(413);
    expect(erro(res).error).toBe('Payload Too Large');
    expect(texto(erro(res))).toBe(
      'Corpo da requisição excede o limite permitido.',
    );
  });

  it('recusa JSON malformado com 400, e nao com 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Content-Type', 'application/json')
      .send('{"descricao":');

    expect(res.status).toBe(400);
    expect(texto(erro(res))).toBe('Corpo da requisição não é um JSON válido.');
  });

  it('nao repassa o texto original do parser, que revela o limite configurado', async () => {
    const gigante = JSON.stringify({ descricao: 'x'.repeat(200 * 1024) });

    const res = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Content-Type', 'application/json')
      .send(gigante);

    const corpo = JSON.stringify(res.body);
    expect(corpo).not.toContain('100kb');
    expect(corpo).not.toMatch(/entity\.too\.large/);
    expect(corpo).not.toMatch(/request entity too large/i);
  });

  it('mantem o formato unico de erro da API', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Content-Type', 'application/json')
      .send('{');

    const body = erro(res);
    expect(body.path).toBe('/api/categories');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.error).toBe('string');
    expect(body.statusCode).toBe(res.status);
  });

  it('corpo dentro do limite passa pelo parser e chega ao roteamento', async () => {
    // 405/404 aqui significa que o parser aceitou e o roteador assumiu — que e
    // exatamente o que se quer provar: o limite nao afeta requisicao normal.
    const res = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Content-Type', 'application/json')
      .send({ nome: 'pequeno' });

    expect([404, 405]).toContain(res.status);
  });
});
