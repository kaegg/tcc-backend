import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const METRICA = {
  participantCode: '7b2f9c1e-4a3d-4e8f-9b6a-1c2d3e4f5a6b',
  sessionCode: '0f1e2d3c-4b5a-4968-8776-655443322110',
  mode: 'formulario',
  task: 'consulta',
  durationMs: 18_900,
  interactionCount: 2,
  errorCount: 0,
  outcome: 'sucesso',
};

describe('Métricas de uso (TCC-030)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;
  const original = process.env.USAGE_METRICS_ENABLED;

  async function subir(coleta: string | undefined) {
    if (coleta === undefined) delete process.env.USAGE_METRICS_ENABLED;
    else process.env.USAGE_METRICS_ENABLED = coleta;
    prisma = createPrismaStub();
    prisma.usageMetric.create.mockResolvedValue({});
    app = await createTestApp(prisma);
    authorization = await authenticateFakeUser(prisma, app);
    // O dublê de autenticação responde `findUnique` só para login e sessão;
    // aqui, a conta aceitou os termos.
    const autenticacao = prisma.user.findUnique.getMockImplementation();
    prisma.user.findUnique.mockImplementation(
      (args: { select?: Record<string, unknown> }) =>
        args.select && 'termsAcceptedAt' in args.select
          ? Promise.resolve({ termsAcceptedAt: new Date('2026-10-01') })
          : (autenticacao?.(args) as Promise<unknown>),
    );
  }

  afterEach(async () => {
    await app.close();
    if (original === undefined) delete process.env.USAGE_METRICS_ENABLED;
    else process.env.USAGE_METRICS_ENABLED = original;
  });

  const status = () =>
    request(app.getHttpServer())
      .get('/api/metrics/status')
      .set('Authorization', authorization);
  const registrar = (corpo: object) =>
    request(app.getHttpServer())
      .post('/api/metrics')
      .set('Authorization', authorization)
      .send(corpo);

  it('exige sessão', async () => {
    await subir('true');
    await request(app.getHttpServer()).post('/api/metrics').expect(401);
    await request(app.getHttpServer()).get('/api/metrics/status').expect(401);
  });

  it('coleta ligada: informa o navegador e grava a tarefa', async () => {
    await subir('true');

    expect((await status().expect(200)).body).toEqual({ collecting: true });
    await registrar(METRICA).expect(204);

    expect(prisma.usageMetric.create).toHaveBeenCalledTimes(1);
    const [{ data }] = prisma.usageMetric.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).not.toHaveProperty('userId');
    expect(data).toMatchObject({
      participantCode: METRICA.participantCode,
      taskCode: 'consulta',
      durationMs: 18_900,
    });
  });

  it('sem USAGE_METRICS_ENABLED=true, aceita e descarta', async () => {
    await subir(undefined);

    expect((await status().expect(200)).body).toEqual({ collecting: false });
    await registrar(METRICA).expect(204);
    expect(prisma.usageMetric.create).not.toHaveBeenCalled();
  });

  it.each([
    ['nome no lugar do identificador', { participantCode: 'Maria Souza' }],
    ['e-mail no lugar da sessão', { sessionCode: 'maria@exemplo.com' }],
    ['tarefa desconhecida', { task: 'T1-despesa' }],
    ['duração negativa', { durationMs: -1 }],
    ['campo a mais', { userId: 'u1' }],
  ])('recusa %s', async (_, invalido) => {
    await subir('true');

    await registrar({ ...METRICA, ...invalido }).expect(400);
    expect(prisma.usageMetric.create).not.toHaveBeenCalled();
  });
});
