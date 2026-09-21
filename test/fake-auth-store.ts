import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Prisma } from './../src/generated/prisma/client';
import { hashPassword } from './../src/users/password';
import type { PrismaStub } from './create-test-app';

const SENHA_DE_TESTE = 'SenhaValida123';

export interface FakeUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  passwordHash: string;
}

interface FakeSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

type Where = Record<string, unknown>;

/**
 * Banco em memoria para `users` e `sessions`.
 *
 * Um dublê de retorno fixo nao serve aqui: rotacao, reuso e logout sao
 * mudancas de estado entre requisicoes, e e exatamente isso que os testes
 * precisam observar.
 */
export function installFakeAuthStore(prisma: PrismaStub, users: FakeUser[]) {
  const sessions: FakeSession[] = [];

  const matches = (row: FakeSession, where: Where): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === 'OR') {
        return (expected as Where[]).some((clause) => matches(row, clause));
      }

      const actual = row[key as keyof FakeSession];

      if (expected && typeof expected === 'object' && 'not' in expected) {
        return actual !== expected.not;
      }

      if (expected && typeof expected === 'object' && 'gt' in expected) {
        return (actual as Date) > (expected as { gt: Date }).gt;
      }

      return actual === expected;
    });

  prisma.user.findUnique.mockImplementation(({ where }: { where: Where }) =>
    Promise.resolve(
      users.find((user) =>
        Object.entries(where).every(
          ([key, value]) => user[key as keyof FakeUser] === value,
        ),
      ) ?? null,
    ),
  );

  prisma.user.update.mockImplementation(
    ({
      where,
      data,
      select,
    }: {
      where: { id: string };
      data: Partial<FakeUser>;
      select?: Record<string, boolean>;
    }) => {
      const row = users.find((user) => user.id === where.id);
      if (!row) return Promise.reject(new Error('Registro nao encontrado.'));

      if (
        data.email &&
        users.some((u) => u.id !== row.id && u.email === data.email)
      ) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: '7.10.0',
            meta: { target: ['email'] },
          }),
        );
      }

      Object.assign(row, data);
      return Promise.resolve(
        select
          ? Object.fromEntries(
              Object.keys(select).map((key) => [
                key,
                row[key as keyof FakeUser],
              ]),
            )
          : { ...row },
      );
    },
  );

  prisma.session.create.mockImplementation(
    ({ data }: { data: Partial<FakeSession> }) => {
      const row: FakeSession = {
        id: randomUUID(),
        userId: data.userId as string,
        refreshTokenHash: data.refreshTokenHash as string,
        previousRefreshTokenHash: null,
        rotatedAt: null,
        expiresAt: data.expiresAt as Date,
        revokedAt: null,
      };
      sessions.push(row);
      return Promise.resolve({ ...row });
    },
  );

  prisma.session.findUnique.mockImplementation(
    ({ where }: { where: Where }) => {
      const row = sessions.find((session) => matches(session, where));
      if (!row) return Promise.resolve(null);

      return Promise.resolve({
        ...row,
        user: users.find((user) => user.id === row.userId),
      });
    },
  );

  prisma.session.updateMany.mockImplementation(
    ({ where, data }: { where: Where; data: Partial<FakeSession> }) => {
      const hit = sessions.filter((session) => matches(session, where));
      hit.forEach((session) => Object.assign(session, data));
      return Promise.resolve({ count: hit.length });
    },
  );

  prisma.session.update.mockImplementation(
    ({ where, data }: { where: Where; data: Partial<FakeSession> }) => {
      const row = sessions.find((session) => matches(session, where));
      if (row) Object.assign(row, data);
      return Promise.resolve(row);
    },
  );

  prisma.session.count.mockImplementation(({ where }: { where: Where }) =>
    Promise.resolve(sessions.filter((s) => matches(s, where)).length),
  );

  return { sessions };
}

/** Cria um usuario no dublê e devolve o `Authorization` de uma sessao dele. */
export async function authenticateFakeUser(
  prisma: PrismaStub,
  app: INestApplication<App>,
): Promise<string> {
  const user: FakeUser = {
    id: '0199a1b2-c3d4-7000-8000-0000000000aa',
    name: 'Usuario de Teste',
    email: 'teste@exemplo.com',
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    passwordHash: await hashPassword(SENHA_DE_TESTE),
  };
  installFakeAuthStore(prisma, [user]);

  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: user.email, password: SENHA_DE_TESTE });

  return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
}
