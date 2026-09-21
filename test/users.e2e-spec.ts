import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';
import { Prisma } from './../src/generated/prisma/client';
import type { UserResponseDto } from './../src/users/dto/user-response.dto';
import {
  createPrismaStub,
  createTestApp,
  type PrismaStub,
} from './create-test-app';

const SENHA = 'SenhaValida123';

const CADASTRO_VALIDO = {
  name: 'Kauan Eguchi',
  email: 'kauan@exemplo.com',
  password: SENHA,
};

const LINHA_CRIADA = {
  id: '0199a1b2-c3d4-7000-8000-000000000001',
  name: CADASTRO_VALIDO.name,
  email: CADASTRO_VALIDO.email,
  createdAt: new Date('2026-09-10T12:00:00.000Z'),
};

const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

/** Argumentos com que o service chamou `user.create`. */
function dadosGravados(prisma: PrismaStub): Record<string, unknown> {
  const [args] = prisma.user.create.mock.calls[0] as [
    { data: Record<string, unknown> },
  ];

  return args.data;
}

function emailDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    { code: 'P2002', clientVersion: '7.10.0', meta: { target: ['email'] } },
  );
}

describe('POST /api/users (TCC-008)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;

  beforeEach(async () => {
    prisma = createPrismaStub();
    prisma.user.create.mockResolvedValue(LINHA_CRIADA);
    app = await createTestApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('dados validos', () => {
    it('cria o usuario e responde 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send(CADASTRO_VALIDO)
        .expect(201);

      expect(res.body as UserResponseDto).toEqual({
        id: LINHA_CRIADA.id,
        name: CADASTRO_VALIDO.name,
        email: CADASTRO_VALIDO.email,
        createdAt: '2026-09-10T12:00:00.000Z',
      });
    });

    it('normaliza e-mail para minusculas e apara espacos', async () => {
      // O CHECK `users_email_lowercase` recusaria o valor cru, e o indice unico
      // deixaria passar o mesmo endereco em caixas diferentes.
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ ...CADASTRO_VALIDO, email: '  KAUAN@Exemplo.COM  ' })
        .expect(201);

      expect(dadosGravados(prisma).email).toBe('kauan@exemplo.com');
    });

    it('apara espacos do nome', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ ...CADASTRO_VALIDO, name: '  Kauan Eguchi  ' })
        .expect(201);

      expect(dadosGravados(prisma).name).toBe('Kauan Eguchi');
    });
  });

  describe('a senha nunca aparece em texto puro', () => {
    it('nao volta na resposta, em nenhum campo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send(CADASTRO_VALIDO)
        .expect(201);

      const corpo = JSON.stringify(res.body);
      expect(corpo).not.toContain(SENHA);
      expect(corpo).not.toMatch(/passwordHash|password/i);
    });

    it('e persistida como hash Argon2id que confere com a senha original', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send(CADASTRO_VALIDO)
        .expect(201);

      const gravado = dadosGravados(prisma);
      expect(gravado.password).toBeUndefined();

      const hash = gravado.passwordHash as string;
      expect(hash).toMatch(/^\$argon2id\$/);
      expect(hash).not.toContain(SENHA);
      await expect(argon2.verify(hash, SENHA)).resolves.toBe(true);
    });
  });

  describe('e-mail duplicado', () => {
    beforeEach(() => {
      prisma.user.create.mockRejectedValue(emailDuplicado());
    });

    it('responde 409 apontando o campo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send(CADASTRO_VALIDO)
        .expect(409);

      expect(erro(res).message).toBe('Este e-mail já está cadastrado.');
      expect(erro(res).fieldErrors).toEqual({
        email: ['Este e-mail já está cadastrado.'],
      });
    });

    it('nao vaza detalhe do banco na mensagem', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send(CADASTRO_VALIDO)
        .expect(409);

      const corpo = JSON.stringify(res.body);
      expect(corpo).not.toMatch(/constraint|P2002|prisma/i);
    });
  });

  describe('campos invalidos', () => {
    it('recusa nome curto, e-mail malformado e senha fraca de uma vez', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ name: 'Ab', email: 'sem-arroba', password: 'curta' })
        .expect(400);

      const { fieldErrors } = erro(res);
      expect(Object.keys(fieldErrors ?? {}).sort()).toEqual([
        'email',
        'name',
        'password',
      ]);
      expect(fieldErrors?.name).toContain(
        'O nome deve ter pelo menos 3 caracteres.',
      );
      expect(fieldErrors?.email).toContain('Informe um e-mail válido.');
      expect(fieldErrors?.password).toEqual(
        expect.arrayContaining([
          'A senha deve ter pelo menos 8 caracteres.',
          'A senha deve conter pelo menos um número.',
        ]),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('mantem `message` como lista plana, o formato da TCC-004', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ name: 'Ab', email: 'sem-arroba', password: 'curta' })
        .expect(400);

      const { message } = erro(res);
      expect(Array.isArray(message)).toBe(true);
      expect(message).toContain('Informe um e-mail válido.');
    });

    it('recusa a confirmacao de senha, que e so do formulario', async () => {
      // `forbidNonWhitelisted` protege contra campo a mais chegar ao banco; o
      // frontend precisa enviar so o que o contrato declara.
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ ...CADASTRO_VALIDO, passwordConfirmation: SENHA })
        .expect(400);

      expect(erro(res).fieldErrors).toHaveProperty('passwordConfirmation');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('recusa senha acima do limite sem tentar gerar o hash', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ ...CADASTRO_VALIDO, password: `a1${'x'.repeat(200)}` })
        .expect(400);

      expect(erro(res).fieldErrors?.password).toContain(
        'A senha deve ter no máximo 128 caracteres.',
      );
    });
  });
});
