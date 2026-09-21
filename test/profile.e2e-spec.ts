import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AuthResponseDto } from './../src/auth/dto/auth-response.dto';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import type { UserResponseDto } from './../src/users/dto/user-response.dto';
import { hashPassword } from './../src/users/password';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { type FakeUser, installFakeAuthStore } from './fake-auth-store';

const SENHA = 'SenhaValida123';
const NOVA_SENHA = 'NovaSenha456';

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

describe('Perfil (TCC-010)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let store: ReturnType<typeof installFakeAuthStore>;
  let ana: FakeUser;
  let bruno: FakeUser;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(SENHA);
  });

  beforeEach(async () => {
    ana = {
      id: '0199a1b2-c3d4-7000-8000-00000000000a',
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
      passwordHash,
    };
    bruno = {
      id: '0199a1b2-c3d4-7000-8000-00000000000b',
      name: 'Bruno Lima',
      email: 'bruno@exemplo.com',
      createdAt: new Date('2026-09-02T12:00:00.000Z'),
      passwordHash,
    };
    prisma = createPrismaStub();
    store = installFakeAuthStore(prisma, [ana, bruno]);
    app = await createTestApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function entrar(email: string, senha = SENHA): Promise<string> {
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: senha })
      .expect(200);

    return `Bearer ${(res.body as AuthResponseDto).accessToken}`;
  }

  describe('PATCH /api/users/me', () => {
    it('exige autenticacao', async () => {
      await http()
        .patch('/api/users/me')
        .send({ name: 'Novo Nome' })
        .expect(401);
    });

    it('altera o nome sem pedir a senha e devolve o perfil atualizado', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ name: '  Ana Souza Lima  ' })
        .expect(200);

      expect(res.body as UserResponseDto).toEqual({
        id: ana.id,
        name: 'Ana Souza Lima',
        email: ana.email,
        createdAt: '2026-09-01T12:00:00.000Z',
      });
      expect(ana.name).toBe('Ana Souza Lima');
    });

    it('altera o e-mail com a senha atual e normaliza a caixa', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ email: '  ANA.NOVA@Exemplo.com ', currentPassword: SENHA })
        .expect(200);

      expect((res.body as UserResponseDto).email).toBe('ana.nova@exemplo.com');
      await entrar('ana.nova@exemplo.com');
    });

    it('trocar o e-mail sem a senha atual e recusado', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ email: 'outro@exemplo.com' })
        .expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('currentPassword');
      expect(ana.email).toBe('ana@exemplo.com');
    });

    it('trocar o e-mail com senha atual errada e recusado', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ email: 'outro@exemplo.com', currentPassword: 'Errada12345' })
        .expect(400);

      expect(erro(res).fieldErrors?.currentPassword).toEqual([
        'Senha atual incorreta.',
      ]);
      expect(ana.email).toBe('ana@exemplo.com');
    });

    it('e-mail de outra conta responde 409 apontando o campo', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ email: bruno.email, currentPassword: SENHA })
        .expect(409);

      expect(erro(res).fieldErrors?.email).toEqual([
        'Este e-mail já está cadastrado.',
      ]);
      expect(bruno.email).toBe('bruno@exemplo.com');
    });

    it('reenviar o proprio e-mail nao exige senha', async () => {
      const auth = await entrar(ana.email);

      await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ name: 'Ana S. Lima', email: 'ANA@exemplo.com' })
        .expect(200);
    });

    it('recusa campos invalidos, todos de uma vez', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ name: 'Ab', email: 'sem-arroba' })
        .expect(400);

      expect(Object.keys(erro(res).fieldErrors ?? {}).sort()).toEqual([
        'email',
        'name',
      ]);
    });

    it('recusa corpo vazio', async () => {
      const auth = await entrar(ana.email);

      await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({})
        .expect(400);
    });

    it('nao aceita campos internos (mass assignment)', async () => {
      const auth = await entrar(ana.email);
      const hashAntes = ana.passwordHash;

      for (const extra of [
        { id: bruno.id },
        { passwordHash: 'x' },
        { createdAt: '2000-01-01T00:00:00.000Z' },
      ]) {
        await http()
          .patch('/api/users/me')
          .set('Authorization', auth)
          .send({ name: 'Ana Souza', ...extra })
          .expect(400);
      }

      expect(ana.passwordHash).toBe(hashAntes);
      expect(ana.id).not.toBe(bruno.id);
    });

    it('so alcanca o usuario do token: nao ha como apontar para outro', async () => {
      const authAna = await entrar(ana.email);

      await http()
        .patch(`/api/users/${bruno.id}`)
        .set('Authorization', authAna)
        .send({ name: 'Invadido' })
        .expect(404);
      await http()
        .patch('/api/users/me')
        .set('Authorization', authAna)
        .send({ name: 'Ana Editada' })
        .expect(200);

      expect(bruno.name).toBe('Bruno Lima');
    });

    it('nunca devolve senha nem hash', async () => {
      const auth = await entrar(ana.email);

      const res = await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ name: 'Ana Editada' })
        .expect(200);

      expect(JSON.stringify(res.body)).not.toMatch(/password|hash|argon2/i);
    });

    it('limita tentativas de senha atual', async () => {
      const auth = await entrar(ana.email);

      for (let i = 0; i < 10; i++) {
        await http()
          .patch('/api/users/me')
          .set('Authorization', auth)
          .send({ email: 'outro@exemplo.com', currentPassword: `Errada${i}12` })
          .expect(400);
      }

      await http()
        .patch('/api/users/me')
        .set('Authorization', auth)
        .send({ email: 'outro@exemplo.com', currentPassword: SENHA })
        .expect(429);
    });
  });

  describe('PUT /api/users/me/password', () => {
    const troca = (auth: string, corpo: object) =>
      http()
        .put('/api/users/me/password')
        .set('Authorization', auth)
        .send(corpo);

    it('exige autenticacao', async () => {
      await http()
        .put('/api/users/me/password')
        .send({ currentPassword: SENHA, newPassword: NOVA_SENHA })
        .expect(401);
    });

    it('altera a senha com hash Argon2id, e a antiga deixa de valer', async () => {
      const auth = await entrar(ana.email);

      await troca(auth, {
        currentPassword: SENHA,
        newPassword: NOVA_SENHA,
      }).expect(204);

      expect(ana.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(argon2.verify(ana.passwordHash, NOVA_SENHA)).resolves.toBe(
        true,
      );
      await http()
        .post('/api/auth/login')
        .send({ email: ana.email, password: SENHA })
        .expect(401);
      await entrar(ana.email, NOVA_SENHA);
    });

    it('encerra as outras sessoes e mantem a atual', async () => {
      const atual = await entrar(ana.email);
      const outraSessao = await entrar(ana.email);
      const doBruno = await entrar(bruno.email);

      await troca(atual, {
        currentPassword: SENHA,
        newPassword: NOVA_SENHA,
      }).expect(204);

      await http()
        .get('/api/auth/me')
        .set('Authorization', outraSessao)
        .expect(401);
      await http().get('/api/auth/me').set('Authorization', atual).expect(200);
      // Sessao de outro usuario nao e tocada.
      await http()
        .get('/api/auth/me')
        .set('Authorization', doBruno)
        .expect(200);
      expect(store.sessions.filter((s) => s.revokedAt)).toHaveLength(1);
    });

    it('senha atual errada e recusada e nada muda', async () => {
      const auth = await entrar(ana.email);
      const antes = ana.passwordHash;

      const res = await troca(auth, {
        currentPassword: 'Errada12345',
        newPassword: NOVA_SENHA,
      }).expect(400);

      expect(erro(res).fieldErrors?.currentPassword).toEqual([
        'Senha atual incorreta.',
      ]);
      expect(ana.passwordHash).toBe(antes);
    });

    it('recusa nova senha fraca com as mesmas regras do cadastro', async () => {
      const auth = await entrar(ana.email);

      const res = await troca(auth, {
        currentPassword: SENHA,
        newPassword: 'curta',
      }).expect(400);

      expect(erro(res).fieldErrors?.newPassword).toEqual(
        expect.arrayContaining([
          'A senha deve ter pelo menos 8 caracteres.',
          'A senha deve conter pelo menos um número.',
        ]),
      );
    });

    it('recusa nova senha igual a atual', async () => {
      const auth = await entrar(ana.email);

      const res = await troca(auth, {
        currentPassword: SENHA,
        newPassword: SENHA,
      }).expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('newPassword');
    });

    it('recusa senha acima do limite sem gerar hash', async () => {
      const auth = await entrar(ana.email);

      await troca(auth, {
        currentPassword: SENHA,
        newPassword: `a1${'x'.repeat(200)}`,
      }).expect(400);
    });

    it('nao guarda resposta em cache', async () => {
      const auth = await entrar(ana.email);

      const res = await troca(auth, {
        currentPassword: SENHA,
        newPassword: NOVA_SENHA,
      }).expect(204);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('limita tentativas de senha atual', async () => {
      const auth = await entrar(ana.email);

      for (let i = 0; i < 5; i++) {
        await troca(auth, {
          currentPassword: `Errada${i}12`,
          newPassword: NOVA_SENHA,
        }).expect(400);
      }

      await troca(auth, {
        currentPassword: SENHA,
        newPassword: NOVA_SENHA,
      }).expect(429);
    });
  });
});
