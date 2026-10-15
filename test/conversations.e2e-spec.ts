import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ConversationDetailDto } from './../src/chat/dto/conversation-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { authenticateFakeUser } from './fake-auth-store';

const USUARIO = '0199a1b2-c3d4-7000-8000-0000000000aa';
const CONVERSA = '0199a1b2-c3d4-7000-8000-0000000000d1';

describe('GET /api/conversations', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let authorization: string;

  beforeEach(async () => {
    prisma = createPrismaStub();
    app = await createTestApp(prisma);
    authorization = await authenticateFakeUser(prisma, app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('lista as conversas recentes só do usuário do token', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: CONVERSA,
        title: 'Gastei 45 reais no mercado ontem',
        updatedAt: new Date('2026-10-14T12:00:00Z'),
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', authorization)
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(res.body).toEqual({
      data: [
        {
          id: CONVERSA,
          title: 'Gastei 45 reais no mercado ontem',
          updatedAt: '2026-10-14T12:00:00.000Z',
        },
      ],
    });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USUARIO },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('devolve o histórico em ordem, com tipo e período das respostas', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: CONVERSA,
      title: 'Quanto gastei em setembro?',
      updatedAt: new Date('2026-10-14T12:00:00Z'),
      messages: [
        {
          id: 'a',
          role: 'user',
          content: 'Quanto gastei em setembro?',
          kind: null,
          reportFrom: null,
          reportTo: null,
        },
        {
          id: 'b',
          role: 'assistant',
          content: 'Em setembro você gastou R$ 120,00.',
          kind: 'sucesso',
          reportFrom: new Date('2026-09-01T00:00:00Z'),
          reportTo: new Date('2026-09-30T00:00:00Z'),
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${CONVERSA}`)
      .set('Authorization', authorization)
      .expect(200);

    const body = res.body as ConversationDetailDto;
    expect(body.messages).toEqual([
      {
        id: 'a',
        role: 'user',
        content: 'Quanto gastei em setembro?',
        kind: null,
        report: null,
      },
      {
        id: 'b',
        role: 'assistant',
        content: 'Em setembro você gastou R$ 120,00.',
        kind: 'sucesso',
        report: { from: '2026-09-01', to: '2026-09-30' },
      },
    ]);
    expect(body.pending).toBeNull();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CONVERSA, userId: USUARIO } }),
    );
  });

  it('responde 404 para conversa de outro usuário ou id que não é UUID', async () => {
    await request(app.getHttpServer())
      .get(`/api/conversations/${CONVERSA}`)
      .set('Authorization', authorization)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/conversations/c1')
      .set('Authorization', authorization)
      .expect(404);
    expect(prisma.conversation.findFirst).toHaveBeenCalledTimes(1);
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/api/conversations').expect(401);
  });
});
