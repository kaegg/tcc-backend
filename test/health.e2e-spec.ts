import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { HealthResponseDto } from './../src/health/dto/health-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';

const SENHA = 'SenhaSuperSecreta';

/** Falha tipica do driver: traz a cadeia de conexao inteira na mensagem. */
const FALHA_DO_DRIVER = new Error(
  `connect ECONNREFUSED postgresql://postgres:${SENHA}@localhost:5432/intellifinance`,
);

const saude = (res: request.Response): HealthResponseDto =>
  res.body as HealthResponseDto;

describe('GET /api/health (TCC-006)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let logsDeErro: string[];

  beforeEach(async () => {
    logsDeErro = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((mensagem: unknown) => {
        logsDeErro.push(String(mensagem));
      });

    prisma = createPrismaStub();
    app = await createTestApp(prisma);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  describe('com o banco respondendo', () => {
    it('responde 200 com o estado agregado e o da dependencia', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);
      const body = saude(res);

      expect(body.status).toBe('ok');
      expect(body.dependencies.database.status).toBe('ok');
      expect(typeof body.dependencies.database.latencyMs).toBe('number');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.uptimeSeconds).toBe('number');
    });

    it('nao permite cache da resposta', async () => {
      // Sem isso o ETag do Express devolveria 304 no meio do polling do
      // frontend, que passaria a nao enxergar a mudanca de estado.
      await request(app.getHttpServer())
        .get('/api/health')
        .expect('Cache-Control', 'no-store');
    });

    it('nao expoe detalhe da infraestrutura', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      const texto = JSON.stringify(res.body);

      // OWASP A05: um health publico nao descreve a infraestrutura.
      expect(texto).not.toMatch(/postgres/i);
      expect(texto).not.toMatch(/version/i);
      expect(texto).not.toMatch(/localhost/i);
      expect(texto).not.toMatch(/5432/);
    });
  });

  describe('com o banco fora', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockRejectedValue(FALHA_DO_DRIVER);
    });

    it('responde 503 e marca o estado como degradado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(503);
      const body = saude(res);

      expect(body.status).toBe('degradado');
      expect(body.dependencies.database.status).toBe('indisponivel');
      expect(body.dependencies.database.latencyMs).toBeUndefined();
    });

    it('nao vaza a credencial nem a mensagem do driver no corpo', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      const texto = JSON.stringify(res.body);

      expect(texto).not.toContain(SENHA);
      expect(texto).not.toContain('ECONNREFUSED');
      expect(texto).not.toContain('postgresql://');
    });

    it('registra o motivo no log, com a credencial mascarada', async () => {
      await request(app.getHttpServer()).get('/api/health');

      const log = logsDeErro.join('\n');
      expect(log).toContain('PostgreSQL');
      expect(log).not.toContain(SENHA);
      expect(log).toContain('postgresql://***:***@localhost:5432');
    });
  });

  it('nao fica pendurado quando a consulta nunca responde', async () => {
    // Com o banco inalcancavel, `$queryRaw` fica preso ate o timeout do pool.
    // Sem o teto da sonda, o cliente do frontend abortaria antes e a
    // interface diria "sem conexao com a API" com a API no ar.
    prisma.$queryRaw.mockImplementation(() => new Promise(() => {}));

    const res = await request(app.getHttpServer()).get('/api/health');

    expect(res.status).toBe(503);
    expect(saude(res).dependencies.database.status).toBe('indisponivel');
  }, 10_000);
});
