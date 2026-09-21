import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type express from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AuthResponseDto } from './../src/auth/dto/auth-response.dto';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { hashPassword } from './../src/users/password';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';
import { type FakeUser, installFakeAuthStore } from './fake-auth-store';

const SENHA = 'SenhaValida123';
const ORIGEM = 'http://localhost:5173';

const corpo = (res: request.Response): AuthResponseDto =>
  res.body as AuthResponseDto;
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

function cookiesDe(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

/** Valor do cookie de refresh, no formato que o navegador reenvia. */
function refreshDe(res: request.Response): string {
  const cookie = cookiesDe(res).find((c) => c.startsWith('refresh_token='));
  return (cookie ?? '').split(';')[0];
}

describe('Autenticacao (TCC-009)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let ana: FakeUser;
  let bruno: FakeUser;
  let store: ReturnType<typeof installFakeAuthStore>;

  beforeAll(async () => {
    const passwordHash = await hashPassword(SENHA);
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
  });

  beforeEach(async () => {
    prisma = createPrismaStub();
    store = installFakeAuthStore(prisma, [ana, bruno]);
    app = await createTestApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const login = (email = ana.email, password = SENHA) =>
    http().post('/api/auth/login').send({ email, password });

  describe('POST /api/auth/login', () => {
    it('credenciais validas iniciam a sessao', async () => {
      const res = await login().expect(200);

      expect(corpo(res).tokenType).toBe('Bearer');
      expect(corpo(res).accessToken).toEqual(expect.any(String));
      expect(corpo(res).user).toEqual({
        id: ana.id,
        name: ana.name,
        email: ana.email,
        createdAt: '2026-09-01T12:00:00.000Z',
      });
      expect(store.sessions).toHaveLength(1);
    });

    it('entrega o refresh token so em cookie httpOnly e SameSite=Strict, restrito a /api/auth', async () => {
      const res = await login().expect(200);

      const cookie = cookiesDe(res).find((c) => c.startsWith('refresh_token='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      expect(JSON.stringify(res.body)).not.toContain('refresh');
    });

    it('nunca devolve senha nem hash', async () => {
      const res = await login().expect(200);

      expect(JSON.stringify(res.body)).not.toMatch(/password|hash|argon2/i);
    });

    it('nao guarda o refresh token em texto puro', async () => {
      const res = await login().expect(200);
      const token = refreshDe(res).split('=')[1];

      expect(store.sessions[0].refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(store.sessions)).not.toContain(token);
    });

    it('normaliza o e-mail antes de procurar a conta', async () => {
      await login('  ANA@Exemplo.com ').expect(200);
    });

    it('responde do mesmo jeito para senha errada e para e-mail sem conta', async () => {
      const senhaErrada = await login(ana.email, 'OutraSenha999').expect(401);
      const semConta = await login('ninguem@exemplo.com').expect(401);

      expect(erro(senhaErrada).message).toBe('E-mail ou senha incorretos.');
      expect(erro(semConta).message).toBe(erro(senhaErrada).message);
      expect(erro(semConta).error).toBe(erro(senhaErrada).error);
      expect(cookiesDe(semConta)).toHaveLength(0);
      expect(store.sessions).toHaveLength(0);
    });

    it('recusa campos invalidos com 400 e sem consultar o banco', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'sem-arroba', password: '' })
        .expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('email');
      expect(erro(res).fieldErrors).toHaveProperty('password');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('recusa senha acima do limite sem gerar hash', async () => {
      await login(ana.email, 'x'.repeat(500)).expect(400);
    });

    it('nao guarda resposta em cache', async () => {
      const res = await login().expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('limita tentativas por IP e devolve 429 com Retry-After', async () => {
      for (let i = 0; i < 10; i++) {
        await login(ana.email, `errada${i}`).expect(401);
      }

      const res = await login().expect(429);
      expect(
        Object.keys(res.headers).some((h) => h.startsWith('retry-after')),
      ).toBe(true);
      expect(erro(res).message).toMatch(/Muitas tentativas/);
    });

    it('limita tentativas contra uma conta mesmo vindas de IPs diferentes', async () => {
      (app.getHttpAdapter().getInstance() as express.Express).set(
        'trust proxy',
        true,
      );

      for (let i = 0; i < 10; i++) {
        await http()
          .post('/api/auth/login')
          .set('X-Forwarded-For', `10.0.0.${i + 1}`)
          .send({ email: ana.email, password: `errada${i}` })
          .expect(401);
      }

      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({ email: ana.email, password: SENHA })
        .expect(429);
    });
  });

  describe('controle de acesso', () => {
    it('endpoint protegido sem token responde 401', async () => {
      const res = await http().get('/api/categories').expect(401);

      expect(erro(res).message).toBe('Sessão inválida ou expirada.');
    });

    it('com token valido o endpoint protegido responde', async () => {
      const { accessToken } = corpo(await login().expect(200));

      await http()
        .get('/api/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('mantem publicos apenas health, cadastro, login, refresh e logout', async () => {
      await http().get('/api/health').expect(200);
      await http().post('/api/auth/refresh').expect(401);
      await http().post('/api/auth/logout').expect(204);
      await http().post('/api/users').send({}).expect(400);
    });

    it('token adulterado e recusado', async () => {
      const { accessToken } = corpo(await login().expect(200));
      const [cabecalho, , assinatura] = accessToken.split('.');
      const carga = Buffer.from(
        JSON.stringify({ sub: bruno.id, sid: 'x', iss: 'intellifinance' }),
      ).toString('base64url');

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${cabecalho}.${carga}.${assinatura}`)
        .expect(401);
    });

    it('token sem assinatura (alg none) e recusado', async () => {
      const b64 = (o: object) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const forjado = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
        sub: ana.id,
        sid: store.sessions[0]?.id ?? 'x',
        iss: 'intellifinance',
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${forjado}`)
        .expect(401);
    });

    it('token assinado com outro segredo e recusado', async () => {
      const intruso = new JwtService({ secret: 'outro-segredo-'.repeat(4) });
      const token = await intruso.signAsync(
        { sub: ana.id, sid: 'x' },
        { issuer: 'intellifinance', expiresIn: 600 },
      );

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('token expirado e recusado', async () => {
      const jwt = app.get(JwtService);
      await login().expect(200);
      const token = await jwt.signAsync(
        { sub: ana.id, sid: store.sessions[0].id },
        { issuer: 'intellifinance', expiresIn: -10 },
      );

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('cada usuario enxerga apenas a propria identidade', async () => {
      const daAna = corpo(await login(ana.email).expect(200));
      const doBruno = corpo(await login(bruno.email).expect(200));

      const euAna = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${daAna.accessToken}`)
        .expect(200);
      const euBruno = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${doBruno.accessToken}`)
        .expect(200);

      expect((euAna.body as { id: string }).id).toBe(ana.id);
      expect((euBruno.body as { id: string }).id).toBe(bruno.id);
    });

    it('token de um usuario nao vale para a sessao de outro', async () => {
      await login(ana.email).expect(200);
      await login(bruno.email).expect(200);
      const jwt = app.get(JwtService);

      // sub de Ana com a sessao de Bruno: assinatura valida, mas a sessao nao e dela.
      const cruzado = await jwt.signAsync(
        { sub: ana.id, sid: store.sessions[1].id },
        { issuer: 'intellifinance', expiresIn: 600 },
      );

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${cruzado}`)
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('restaura a sessao a partir do cookie', async () => {
      const entrada = await login().expect(200);

      const res = await http()
        .post('/api/auth/refresh')
        .set('Origin', ORIGEM)
        .set('Cookie', refreshDe(entrada))
        .expect(200);

      expect(corpo(res).user.id).toBe(ana.id);
      expect(corpo(res).accessToken).toEqual(expect.any(String));
    });

    it('rotaciona: o cookie novo e diferente e o antigo deixa de valer', async () => {
      const entrada = await login().expect(200);
      const antigo = refreshDe(entrada);

      const primeira = await http()
        .post('/api/auth/refresh')
        .set('Cookie', antigo)
        .expect(200);

      expect(refreshDe(primeira)).not.toBe(antigo);
      expect(store.sessions[0].previousRefreshTokenHash).not.toBeNull();
    });

    it('sem cookie responde 401', async () => {
      await http().post('/api/auth/refresh').set('Origin', ORIGEM).expect(401);
    });

    it('cookie desconhecido responde 401 e manda apagar o cookie', async () => {
      const res = await http()
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=inventado')
        .expect(401);

      expect(cookiesDe(res).join(';')).toMatch(/refresh_token=;/);
    });

    it('recusa origem fora da lista (CSRF)', async () => {
      const entrada = await login().expect(200);

      await http()
        .post('/api/auth/refresh')
        .set('Origin', 'https://site-malicioso.example')
        .set('Cookie', refreshDe(entrada))
        .expect(403);
    });

    it('reuso de token antigo fora da janela de tolerancia revoga a sessao inteira', async () => {
      const entrada = await login().expect(200);
      const antigo = refreshDe(entrada);

      const rotacionada = await http()
        .post('/api/auth/refresh')
        .set('Cookie', antigo)
        .expect(200);

      // Simula o tempo passando desde a rotacao.
      store.sessions[0].rotatedAt = new Date(Date.now() - 60_000);

      await http().post('/api/auth/refresh').set('Cookie', antigo).expect(401);
      expect(store.sessions[0].revokedAt).not.toBeNull();

      // O token legitimo mais recente tambem cai: nao se sabe quem tem o cookie.
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', refreshDe(rotacionada))
        .expect(401);
    });

    it('reuso logo apos a rotacao (duas abas) recusa sem derrubar a sessao', async () => {
      const entrada = await login().expect(200);
      const antigo = refreshDe(entrada);

      const rotacionada = await http()
        .post('/api/auth/refresh')
        .set('Cookie', antigo)
        .expect(200);
      await http().post('/api/auth/refresh').set('Cookie', antigo).expect(401);

      expect(store.sessions[0].revokedAt).toBeNull();
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', refreshDe(rotacionada))
        .expect(200);
    });

    it('sessao vencida nao renova', async () => {
      const entrada = await login().expect(200);
      store.sessions[0].expiresAt = new Date(Date.now() - 1000);

      await http()
        .post('/api/auth/refresh')
        .set('Cookie', refreshDe(entrada))
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('encerra o acesso ate uma nova autenticacao', async () => {
      const entrada = await login().expect(200);
      const { accessToken } = corpo(entrada);
      const cookie = refreshDe(entrada);

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await http()
        .post('/api/auth/logout')
        .set('Origin', ORIGEM)
        .set('Cookie', cookie)
        .expect(204);
      expect(cookiesDe(res).join(';')).toMatch(/refresh_token=;/);

      // O access token ainda nao venceu, mas a sessao foi revogada.
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      await http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);

      await login().expect(200);
    });

    it('e idempotente e nao exige sessao', async () => {
      await http().post('/api/auth/logout').expect(204);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', 'refresh_token=inventado')
        .expect(204);
    });

    it('encerrar a sessao de um usuario nao afeta a de outro', async () => {
      const daAna = await login(ana.email).expect(200);
      const doBruno = await login(bruno.email).expect(200);

      await http()
        .post('/api/auth/logout')
        .set('Cookie', refreshDe(daAna))
        .expect(204);

      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${corpo(doBruno).accessToken}`)
        .expect(200);
    });

    it('recusa origem fora da lista (CSRF)', async () => {
      await http()
        .post('/api/auth/logout')
        .set('Origin', 'https://site-malicioso.example')
        .expect(403);
    });
  });

  describe('limite no cadastro', () => {
    it('devolve 429 apos exceder as tentativas por IP', async () => {
      for (let i = 0; i < 5; i++) {
        await http().post('/api/users').send({}).expect(400);
      }

      await http().post('/api/users').send({}).expect(429);
    });
  });
});
