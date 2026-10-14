import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { formatAmount } from './../src/chat/extraction/registration-reply';
import { parseCorsOrigins } from './../src/common/cors-origins';
import { Prisma } from './../src/generated/prisma/client';
import {
  createOllamaStub,
  createPrismaStub,
  createTestApp,
  type OllamaStub,
  type PrismaStub,
} from './create-test-app';

const USUARIO = '0199a1b2-c3d4-7000-8000-0000000000a1';
const SESSAO = '0199a1b2-c3d4-7000-8000-0000000000b1';
const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';

const CATEGORIAS = [
  { id: ALIMENTACAO, name: 'Alimentação', type: 'despesa' },
  { id: SALARIO, name: 'Salário', type: 'receita' },
];

type Ack = {
  ok: boolean;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  reply?: string;
};
type Fim = { pending: { proposal: { id: string } | null } | null };

/** Saída do modelo: só a intenção e as sugestões, como no Qwen real. */
function modelo(intent: string, entidades: Record<string, unknown> = {}) {
  return JSON.stringify({
    intent,
    entities: {
      type: null,
      amount: null,
      category: null,
      description: null,
      ...entidades,
    },
    ambiguous: false,
    reply: '',
  });
}

/**
 * RF26 (TCC-029): a mesma tarefa feita pelo formulário (REST) e pelo chatbot
 * (Socket.IO), com o mesmo usuário, tem de gravar e calcular o mesmo. Se um
 * dia um caminho ganhar regra própria, estes testes acusam.
 */
describe('Paridade entre formulário e chatbot (TCC-029)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let ollama: OllamaStub;
  let base: string;
  let origem: string;
  let token: string;
  let socket: Socket;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = createPrismaStub();
    prisma.session.count.mockResolvedValue(1);
    prisma.category.findMany.mockResolvedValue(CATEGORIAS);
    prisma.category.count.mockImplementation(
      ({ where }: { where: { id: string; type: string } }) =>
        Promise.resolve(
          CATEGORIAS.some(
            (item) => item.id === where.id && item.type === where.type,
          )
            ? 1
            : 0,
        ),
    );
    prisma.transaction.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...data,
          id: '0199a1b2-c3d4-7000-8000-0000000000f1',
          amount: new Prisma.Decimal(data.amount as string),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          category: {
            name: CATEGORIAS.find((item) => item.id === data.categoryId)?.name,
          },
        }),
    );
    ollama = createOllamaStub();
    app = await createTestApp(prisma, ollama);
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as unknown as Server;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    origem = parseCorsOrigins(
      app
        .get(ConfigService)
        .get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    )[0];

    token = await app
      .get(JwtService, { strict: false })
      .signAsync(
        { sub: USUARIO, sid: SESSAO },
        { algorithm: 'HS256', issuer: 'intellifinance', expiresIn: 900 },
      );
    socket = io(`${base}/chat`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { Origin: origem },
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  });

  afterEach(async () => {
    socket.disconnect();
    jest.restoreAllMocks();
    await app.close();
  });

  const formulario = () => ({
    post: (corpo: object) =>
      request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send(corpo),
    relatorio: (from: string, to: string) =>
      request(app.getHttpServer())
        .get('/api/reports/overview')
        .query({ from, to })
        .set('Authorization', `Bearer ${token}`),
  });

  let mensagens = 0;
  /** Envia ao chatbot com a saída do modelo dada; devolve o texto e o fim. */
  async function conversar(texto: string, saidaDoModelo: string) {
    ollama.chatStream.mockImplementationOnce(function* () {
      yield saidaDoModelo;
      return {};
    });
    const id = `m${++mensagens}`;
    const pedacos: string[] = [];
    const onChunk = (chunk: { id: string; text: string }) => {
      if (chunk.id === id) pedacos.push(chunk.text);
    };
    socket.on('reply:chunk', onChunk);
    const fim = new Promise<Fim>((resolve) =>
      socket.once('reply:end', resolve),
    );
    await socket.emitWithAck('message:send', {
      id,
      conversationId: 'c1',
      content: texto,
    });
    const end = await fim;
    socket.off('reply:chunk', onChunk);
    return { texto: pedacos.join(''), proposalId: end.pending?.proposal?.id };
  }

  const confirmar = (proposalId: string) =>
    socket.emitWithAck('operation:confirm', {
      conversationId: 'c1',
      proposalId,
    }) as Promise<Ack>;

  const gravado = (chamada: number) =>
    (
      prisma.transaction.create.mock.calls[chamada] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;

  /** O que os dois caminhos precisam gravar igual; `source` é a diferença. */
  const semOrigem = (data: Record<string, unknown>) => {
    const copia = { ...data };
    delete copia.source;
    return copia;
  };

  describe('cadastro', () => {
    it.each([
      {
        tarefa: 'despesa',
        corpo: {
          type: 'despesa',
          amount: '45.90',
          categoryId: ALIMENTACAO,
          date: '2026-10-05',
          description: 'Mercado',
        },
        mensagem: 'gastei 45,90 no mercado em 05/10/2026',
        saida: modelo('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
          description: 'Mercado',
        }),
      },
      {
        tarefa: 'receita',
        corpo: {
          type: 'receita',
          amount: '3000.00',
          categoryId: SALARIO,
          date: '2026-10-01',
          description: 'Salário de outubro',
        },
        mensagem: 'recebi 3.000 de salário em 01/10/2026',
        saida: modelo('registrar_lancamento', {
          type: 'receita',
          category: 'Salário',
          description: 'Salário de outubro',
        }),
      },
    ])(
      '$tarefa: os dois modos gravam o mesmo lançamento',
      async ({ corpo, mensagem, saida }) => {
        await formulario().post(corpo).expect(201);

        const { proposalId } = await conversar(mensagem, saida);
        expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
        expect(await confirmar(proposalId ?? '')).toMatchObject({ ok: true });

        expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
        const pelo = { formulario: gravado(0), chatbot: gravado(1) };
        expect(semOrigem(pelo.chatbot)).toEqual(semOrigem(pelo.formulario));
        expect(pelo.formulario.source).toBe('formulario');
        expect(pelo.chatbot.source).toBe('assistente');
        expect(pelo.chatbot.userId).toBe(USUARIO);
      },
    );

    it('os dois modos recusam o mesmo dado, com a mesma mensagem', async () => {
      const { proposalId } = await conversar(
        'gastei 45,90 no mercado em 05/10/2026',
        modelo('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );

      for (const invalido of [
        { amount: '0' },
        { date: '2026-02-30' },
        { description: 'ab' },
        { categoryId: SALARIO },
      ]) {
        const corpo = {
          type: 'despesa',
          amount: '45.90',
          categoryId: ALIMENTACAO,
          date: '2026-10-05',
          ...invalido,
        };

        const rest = await formulario().post(corpo).expect(400);
        const chat = (await socket.emitWithAck('operation:edit', {
          conversationId: 'c1',
          proposalId,
          values: corpo,
        })) as Ack;

        expect(chat).toMatchObject({ ok: false, code: 'dados_invalidos' });
        expect(chat.fieldErrors).toEqual(
          (rest.body as { fieldErrors: unknown }).fieldErrors,
        );
      }
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('consulta', () => {
    beforeEach(() => {
      prisma.transaction.groupBy.mockResolvedValue([
        {
          type: 'despesa',
          categoryId: ALIMENTACAO,
          date: new Date('2026-10-05T00:00:00.000Z'),
          _sum: { amount: new Prisma.Decimal('45.9') },
          _count: { _all: 2 },
        },
        {
          type: 'receita',
          categoryId: SALARIO,
          date: new Date('2026-10-01T00:00:00.000Z'),
          _sum: { amount: new Prisma.Decimal('3000') },
          _count: { _all: 1 },
        },
      ]);
    });

    it('a mesma consulta, a mesma pergunta ao banco e os mesmos números', async () => {
      const tela = await formulario()
        .relatorio('2026-10-01', '2026-10-31')
        .expect(200);
      const relatorio = tela.body as {
        income: string;
        expense: string;
        balance: string;
        savingsRate: string;
        transactionCount: number;
      };

      const resumo = await conversar(
        'resumo de 01/10/2026 a 31/10/2026',
        modelo('obter_resumo'),
      );
      const saldo = await conversar(
        'qual meu saldo de 01/10/2026 a 31/10/2026?',
        modelo('consultar_relatorio'),
      );

      const [doFormulario, doResumo, doSaldo] =
        prisma.transaction.groupBy.mock.calls.map((call: unknown[]) => call[0]);
      expect(doResumo).toEqual(doFormulario);
      expect(doSaldo).toEqual(doFormulario);

      expect(resumo.texto).toContain(
        `receitas de ${formatAmount(relatorio.income)}`,
      );
      expect(resumo.texto).toContain(
        `despesas de ${formatAmount(relatorio.expense)}`,
      );
      expect(resumo.texto).toContain(
        `saldo de ${formatAmount(relatorio.balance)}`,
      );
      expect(resumo.texto).toContain(
        `em ${relatorio.transactionCount} lançamentos`,
      );
      expect(saldo.texto).toContain(
        `${Number(relatorio.savingsRate).toLocaleString('pt-BR')}% das receitas`,
      );
    });

    it('os dois modos recusam o mesmo período, com a mesma mensagem', async () => {
      const tela = await formulario()
        .relatorio('2020-01-01', '2026-12-31')
        .expect(400);
      const mensagem = (tela.body as { fieldErrors: { to: string[] } })
        .fieldErrors.to[0];

      const resposta = await conversar(
        'resumo de 01/01/2020 a 31/12/2026',
        modelo('obter_resumo'),
      );

      expect(resposta.texto).toContain(mensagem);
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });
  });
});
