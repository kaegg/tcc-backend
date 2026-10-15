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

  describe('PATCH (renomear)', () => {
    it('renomeia a conversa do usuário do token, com o nome aparado', async () => {
      prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
      prisma.conversation.findFirst.mockResolvedValue({
        id: CONVERSA,
        title: 'Gastei 45 no mercado',
        updatedAt: new Date('2026-10-15T12:00:00Z'),
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/conversations/${CONVERSA}`)
        .set('Authorization', authorization)
        .send({ title: '  Mercado   de outubro ' })
        .expect(200);

      expect(res.body).toEqual({
        id: CONVERSA,
        title: 'Mercado de outubro',
        updatedAt: '2026-10-15T12:00:00.000Z',
      });
      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: CONVERSA, userId: USUARIO },
        data: {
          title: 'Mercado de outubro',
          updatedAt: new Date('2026-10-15T12:00:00Z'),
        },
      });
    });

    it('recusa nome vazio ou longo demais sem tocar no banco', async () => {
      for (const title of ['   ', 'x'.repeat(121), 42]) {
        await request(app.getHttpServer())
          .patch(`/api/conversations/${CONVERSA}`)
          .set('Authorization', authorization)
          .send({ title })
          .expect(400);
      }
      expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('responde 404 para conversa de outro usuário ou inexistente', async () => {
      await request(app.getHttpServer())
        .patch(`/api/conversations/${CONVERSA}`)
        .set('Authorization', authorization)
        .send({ title: 'Outro nome' })
        .expect(404);
    });
  });

  describe('DELETE', () => {
    it('exclui a conversa do usuário do token e responde 204', async () => {
      prisma.conversation.deleteMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .delete(`/api/conversations/${CONVERSA}`)
        .set('Authorization', authorization)
        .expect(204);

      // As mensagens saem pelo ON DELETE CASCADE da FK, conferido no banco
      // real em `schema-constraints.e2e-spec.ts`.
      expect(prisma.conversation.deleteMany).toHaveBeenCalledWith({
        where: { id: CONVERSA, userId: USUARIO },
      });
    });

    it('responde 404 para conversa de outro usuário, inexistente ou id inválido', async () => {
      await request(app.getHttpServer())
        .delete(`/api/conversations/${CONVERSA}`)
        .set('Authorization', authorization)
        .expect(404);

      await request(app.getHttpServer())
        .delete('/api/conversations/c1')
        .set('Authorization', authorization)
        .expect(404);
      expect(prisma.conversation.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('exige sessão', async () => {
      await request(app.getHttpServer())
        .delete(`/api/conversations/${CONVERSA}`)
        .expect(401);
      expect(prisma.conversation.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/api/conversations').expect(401);
  });
});
