import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import type { CategoryListResponseDto } from './../src/categories/dto/category-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const CATEGORIAS = [
  {
    id: '0199a1b2-c3d4-7000-8000-000000000001',
    name: 'Salário',
    type: 'receita',
  },
  {
    id: '0199a1b2-c3d4-7000-8000-000000000002',
    name: 'Alimentação',
    type: 'despesa',
  },
];

const lista = (res: request.Response): CategoryListResponseDto =>
  res.body as CategoryListResponseDto;

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

const texto = (body: ApiErrorBody): string =>
  Array.isArray(body.message) ? body.message.join(' ') : body.message;

describe('GET /api/categories (TCC-006)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;

  beforeEach(async () => {
    prisma = createPrismaStub();
    prisma.category.findMany.mockResolvedValue(CATEGORIAS);
    app = await createTestApp(prisma);
    authorization = await authenticateFakeUser(prisma, app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve a colecao dentro do envelope `data`', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', authorization)
      .expect(200);

    expect(lista(res)).toEqual({ data: CATEGORIAS });
  });

  it('consulta apenas categorias ativas', async () => {
    await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', authorization)
      .expect(200);

    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('soma o filtro de tipo ao escopo de ativas', async () => {
    await request(app.getHttpServer())
      .get('/api/categories?type=receita')
      .set('Authorization', authorization)
      .expect(200);

    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, type: 'receita' } }),
    );
  });

  it('nao devolve isActive nem carimbos de tempo', async () => {
    // A garantia real esta no `select` do service: os campos nem saem do banco.
    await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', authorization)
      .expect(200);

    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, name: true, type: true },
      }),
    );
  });

  it('sem autenticacao responde 401 e nao consulta o banco', async () => {
    await request(app.getHttpServer()).get('/api/categories').expect(401);

    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('so expoe id, nome e tipo, mesmo que a consulta traga mais', async () => {
    prisma.category.findMany.mockResolvedValue([
      { ...CATEGORIAS[0], isActive: true, createdAt: new Date() },
    ]);

    const res = await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', authorization)
      .expect(200);

    expect(lista(res).data[0]).toEqual(CATEGORIAS[0]);
  });

  it('rejeita tipo fora do dominio', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories?type=xpto')
      .set('Authorization', authorization)
      .expect(400);

    expect(texto(erro(res))).toContain('receita ou despesa');
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('rejeita parametro nao declarado, citando o nome', async () => {
    // `forbidNonWhitelisted` vale para a query string tambem. E por isso que o
    // cliente nunca pode anexar cache-buster do tipo `?_=123`.
    const res = await request(app.getHttpServer())
      .get('/api/categories?tipo=receita')
      .set('Authorization', authorization)
      .expect(400);

    expect(texto(erro(res))).toContain('tipo');
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });
});
