import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { CommonModule } from './../src/common/common.module';
import type { ApiErrorBody } from './../src/common/filters/all-exceptions.filter';

const SENHA = 'SenhaSuperSecreta';

/** O `body` do supertest e `any`; aqui ele passa a ter o contrato da API. */
const erro = (res: request.Response): ApiErrorBody => res.body as ApiErrorBody;

/** Junta as mensagens, que podem vir como string ou lista (ValidationPipe). */
const texto = (body: ApiErrorBody): string =>
  Array.isArray(body.message) ? body.message.join(' ') : body.message;

class LancamentoDto {
  @IsString()
  @IsNotEmpty()
  descricao!: string;

  @IsInt()
  valor!: number;
}

/** Controller so deste teste, para exercitar os caminhos de erro da API. */
@Controller('boom')
class BoomController {
  @Get('raw')
  raw(): string {
    // Simula uma falha do driver do banco, que traz a URL completa na mensagem.
    throw new Error(
      `connect ECONNREFUSED postgresql://postgres:${SENHA}@localhost:5432/intellifinance`,
    );
  }

  @Get('nao-encontrado')
  naoEncontrado(): string {
    throw new NotFoundException('Lancamento nao encontrado');
  }

  @Post('validar')
  validar(@Body() dto: LancamentoDto): LancamentoDto {
    return dto;
  }
}

describe('Padronizacao de erros da API (TCC-004)', () => {
  let app: INestApplication<App>;
  let logsDeErro: string[];

  beforeEach(async () => {
    logsDeErro = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((msg: unknown) => void logsDeErro.push(String(msg)));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CommonModule],
      controllers: [BoomController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('usa o mesmo formato de corpo em qualquer erro', async () => {
    const body = erro(
      await request(app.getHttpServer())
        .get('/boom/nao-encontrado')
        .expect(404),
    );

    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Lancamento nao encontrado',
      path: '/boom/nao-encontrado',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('aplica o mesmo formato em rota inexistente', async () => {
    const body = erro(
      await request(app.getHttpServer())
        .get('/rota-que-nao-existe')
        .expect(404),
    );

    expect(body).toMatchObject({
      statusCode: 404,
      path: '/rota-que-nao-existe',
    });
    expect(body.timestamp).toBeDefined();
  });

  // Criterio de aceite: "Mensagens de erro nao expoem dados sensiveis".
  it('nao vaza credencial do banco na resposta de erro interno', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/boom/raw')
      .expect(500);

    const corpoBruto = JSON.stringify(resposta.body);

    expect(corpoBruto).not.toContain(SENHA);
    expect(corpoBruto).not.toContain('postgresql://');
    expect(corpoBruto).not.toContain('ECONNREFUSED');
    expect(resposta.body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Erro interno no servidor. Tente novamente em instantes.',
    });
    // Sem stack trace na resposta.
    expect(corpoBruto).not.toContain('at ');
  });

  // RNF08: o log tecnico tambem nao pode conter credencial.
  it('registra o erro no servidor, mas com a credencial mascarada', async () => {
    await request(app.getHttpServer()).get('/boom/raw').expect(500);

    expect(logsDeErro).toHaveLength(1);
    expect(logsDeErro[0]).toContain('ECONNREFUSED'); // contexto tecnico preservado
    expect(logsDeErro[0]).not.toContain(SENHA); // credencial removida
    expect(logsDeErro[0]).toContain('***:***@');
  });

  it('rejeita payload invalido com a lista de mensagens de validacao', async () => {
    const body = erro(
      await request(app.getHttpServer())
        .post('/boom/validar')
        .send({ descricao: '', valor: 'nao e numero' })
        .expect(400),
    );

    expect(body.statusCode).toBe(400);
    expect(Array.isArray(body.message)).toBe(true);
    expect(texto(body)).toMatch(/descricao|valor/);
  });

  it('rejeita campo nao declarado no DTO', async () => {
    const body = erro(
      await request(app.getHttpServer())
        .post('/boom/validar')
        .send({ descricao: 'Mercado', valor: 35, saldoAdmin: 999 })
        .expect(400),
    );

    expect(texto(body)).toContain('saldoAdmin');
  });

  it('aceita payload valido', async () => {
    await request(app.getHttpServer())
      .post('/boom/validar')
      .send({ descricao: 'Mercado', valor: 35 })
      .expect(201, { descricao: 'Mercado', valor: 35 });
  });
});
