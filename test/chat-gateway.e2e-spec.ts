import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import type { App } from 'supertest/types';
import { parseCorsOrigins } from './../src/common/cors-origins';
import { Prisma } from './../src/generated/prisma/client';
import { LlmError } from './../src/llm/llm.errors';
import type { ChatRequest } from './../src/llm/ollama.service';
import {
  createOllamaStub,
  createPrismaStub,
  createTestApp,
  type OllamaStub,
  type PrismaStub,
} from './create-test-app';

const USUARIO = '0199a1b2-c3d4-7000-8000-0000000000a1';
const SESSAO = '0199a1b2-c3d4-7000-8000-0000000000b1';
const CATEGORIA = '0199a1b2-c3d4-7000-8000-00000000c001';

type Ack = { ok: boolean; code?: string; message?: string };

/** Abertura da saída estruturada até o início do texto ao usuário. */
const INICIO_DA_SAIDA =
  '{"intent":"ajuda","entities":{"type":null,"amount":null,"date":null,' +
  '"category":null,"description":null,"periodStart":null,"periodEnd":null},' +
  '"ambiguous":false,"reply":"';

/** Saída estruturada do modelo, com o texto ao usuário nos pedaços dados. */
function* responder(...pedacos: string[]) {
  yield INICIO_DA_SAIDA;
  for (const pedaco of pedacos) yield pedaco;
  yield '"}';
  return {};
}

/** Fica gerando até ser cancelado, como uma resposta longa do modelo. */
async function* pendurado(request: ChatRequest) {
  yield `${INICIO_DA_SAIDA}começo`;
  await new Promise((_, reject) => {
    request.signal?.addEventListener('abort', () =>
      reject(new LlmError('cancelado')),
    );
  });
}

describe('Gateway do chat (TCC-022)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaStub;
  let ollama: OllamaStub;
  let base: string;
  let origem: string;
  let sockets: Socket[];

  async function token(segredo?: string, expiresIn = 900): Promise<string> {
    const jwt = app.get(JwtService, { strict: false });
    return jwt.signAsync(
      { sub: USUARIO, sid: SESSAO },
      {
        algorithm: 'HS256',
        issuer: 'intellifinance',
        expiresIn,
        ...(segredo ? { secret: segredo } : {}),
      },
    );
  }

  function abrir(
    opcoes: {
      token?: string;
      origin?: string | null;
      transports?: ('websocket' | 'polling')[];
    } = {},
  ): Socket {
    const socket = io(`${base}/chat`, {
      path: '/socket.io',
      transports: opcoes.transports ?? ['websocket'],
      auth: opcoes.token ? { token: opcoes.token } : {},
      extraHeaders:
        opcoes.origin === null ? {} : { Origin: opcoes.origin ?? origem },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  function conectar(opcoes: Parameters<typeof abrir>[0] = {}) {
    const socket = abrir(opcoes);
    return new Promise<Socket>((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  async function conectado() {
    return conectar({ token: await token() });
  }

  function esperar<T>(socket: Socket, evento: string) {
    return new Promise<T>((resolve) => socket.once(evento, resolve));
  }

  /** A geração começou: o texto do modelo não chega mais ao cliente. */
  async function modeloChamado() {
    while (ollama.chatStream.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const enviar = (socket: Socket, content: string, id = 'm1') =>
    socket.emitWithAck('message:send', {
      id,
      conversationId: 'c1',
      content,
    }) as Promise<Ack>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    sockets = [];
    prisma = createPrismaStub();
    prisma.session.count.mockResolvedValue(1);
    ollama = createOllamaStub();
    app = await createTestApp(prisma, ollama);
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as unknown as Server;
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    origem = parseCorsOrigins(
      app
        .get(ConfigService)
        .get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    )[0];
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.disconnect());
    jest.restoreAllMocks();
    await app.close();
  });

  describe('conexão', () => {
    it('aceita token válido de sessão ativa', async () => {
      const socket = await conectado();
      expect(socket.connected).toBe(true);
    });

    it('recusa sem token', async () => {
      await expect(conectar()).rejects.toMatchObject({
        data: { code: 'sessao_expirada' },
      });
    });

    it('recusa token assinado com outro segredo', async () => {
      const forjado = await token('outro-segredo-qualquer-0123456789abcdef');
      await expect(conectar({ token: forjado })).rejects.toMatchObject({
        data: { code: 'sessao_expirada' },
      });
    });

    it('recusa token de sessão revogada', async () => {
      prisma.session.count.mockResolvedValue(0);
      await expect(conectar({ token: await token() })).rejects.toMatchObject({
        data: { code: 'sessao_expirada' },
      });
    });

    it('recusa página de outra origem, mesmo com token válido', async () => {
      await expect(
        conectar({
          token: await token(),
          origin: 'https://site-malicioso.com',
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('não oferece long-polling', async () => {
      await expect(
        conectar({ token: await token(), transports: ['polling'] }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('limita conexões simultâneas por usuário', async () => {
      const valido = await token();
      await conectar({ token: valido });
      await conectar({ token: valido });
      await conectar({ token: valido });

      await expect(conectar({ token: valido })).rejects.toMatchObject({
        data: { code: 'limite_excedido' },
      });
    });
  });

  describe('consulta de relatórios (TCC-027)', () => {
    it('responde com os totais do banco, só do usuário, e informa o período', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: CATEGORIA, name: 'Alimentação', type: 'despesa' },
      ]);
      prisma.transaction.groupBy.mockResolvedValue([
        {
          type: 'despesa',
          categoryId: CATEGORIA,
          date: new Date('2026-10-05T00:00:00.000Z'),
          _sum: { amount: new Prisma.Decimal('45.9') },
          _count: { _all: 2 },
        },
      ]);
      ollama.chatStream.mockImplementation(function* () {
        yield JSON.stringify({
          intent: 'consultar_relatorio',
          entities: {
            type: 'despesa',
            amount: null,
            category: null,
            description: null,
          },
          ambiguous: false,
          reply: 'Você gastou R$ 1.000.000!',
        });
        return {};
      });
      const socket = await conectado();
      const pedacos: string[] = [];
      socket.on('reply:chunk', ({ text }: { text: string }) =>
        pedacos.push(text),
      );

      const fim = esperar<{ report: unknown }>(socket, 'reply:end');
      await enviar(socket, 'quanto gastei de 01/10/2026 a 31/10/2026?');

      expect((await fim).report).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(pedacos.join('')).toBe(
        'Em outubro de 2026 (01/10/2026 a 31/10/2026), suas despesas somaram R$ 45,90, em 2 lançamentos. Todas em Alimentação.',
      );
      const [{ where }] = prisma.transaction.groupBy.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(where).toMatchObject({ userId: USUARIO, deletedAt: null });
    });
  });

  describe('lançamento em andamento (TCC-025)', () => {
    const registro = (entidades: Record<string, unknown>) =>
      JSON.stringify({
        intent: 'registrar_lancamento',
        entities: {
          type: null,
          amount: null,
          category: null,
          description: null,
          periodStart: null,
          periodEnd: null,
          ...entidades,
        },
        ambiguous: false,
        reply: '',
      });

    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([
        { id: CATEGORIA, name: 'Alimentação', type: 'despesa' },
      ]);
    });

    it('informa o que falta no fim da resposta e completa com a resposta seguinte', async () => {
      ollama.chatStream.mockImplementation(function* () {
        yield registro({ type: 'despesa', category: 'Alimentação' });
        return {};
      });
      const socket = await conectado();

      const primeiro = esperar<{ pending: unknown }>(socket, 'reply:end');
      await enviar(socket, 'gastei no mercado');
      expect((await primeiro).pending).toEqual({
        missing: ['valor'],
        ready: false,
        proposal: null,
      });

      const segundo = esperar<{ pending: unknown }>(socket, 'reply:end');
      await enviar(socket, '45,90', 'm2');
      expect((await segundo).pending).toMatchObject({
        missing: [],
        ready: true,
        proposal: { amount: '45.90', categoryName: 'Alimentação' },
      });
      expect(ollama.chatStream).toHaveBeenCalledTimes(1);
    });

    it('cancela pelo evento e confirma que nada foi registrado', async () => {
      ollama.chatStream.mockImplementation(function* () {
        yield registro({ type: 'despesa' });
        return {};
      });
      const socket = await conectado();
      const fim = esperar(socket, 'reply:end');
      await enviar(socket, 'gastei 30');
      await fim;

      const ack = (await socket.emitWithAck('operation:cancel', {
        conversationId: 'c1',
      })) as Ack & { reply?: string };

      expect(ack).toMatchObject({ ok: true });
      expect(ack.reply).toMatch(/Nada foi registrado/);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    describe('confirmação e edição (TCC-026)', () => {
      type Fim = {
        pending: { proposal: { id: string } | null } | null;
        outcome: string | null;
      };

      beforeEach(() => {
        prisma.transaction.create.mockImplementation(
          ({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              ...data,
              id: '0199a1b2-c3d4-7000-8000-0000000000f1',
              amount: new Prisma.Decimal(data.amount as string),
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
              category: { name: 'Alimentação' },
            }),
        );
        ollama.chatStream.mockImplementation(function* () {
          yield registro({
            type: 'despesa',
            category: 'Alimentação',
            description: 'Mercado',
          });
          return {};
        });
      });

      async function comProposta() {
        const socket = await conectado();
        const fim = esperar<Fim>(socket, 'reply:end');
        await enviar(socket, 'gastei 45 no mercado');
        const { pending } = await fim;
        return { socket, proposalId: pending?.proposal?.id ?? '' };
      }

      const confirmar = (socket: Socket, proposalId: string) =>
        socket.emitWithAck('operation:confirm', {
          conversationId: 'c1',
          proposalId,
        }) as Promise<Ack & { reply?: string }>;

      it('grava como assistente, para o usuário do token, só depois do botão', async () => {
        const { socket, proposalId } = await comProposta();
        expect(prisma.transaction.create).not.toHaveBeenCalled();

        const ack = await confirmar(socket, proposalId);

        expect(ack).toMatchObject({ ok: true });
        expect(ack.reply).toMatch(/^Pronto, registrei/);
        expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
        const [{ data }] = prisma.transaction.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ];
        expect(data).toMatchObject({
          userId: USUARIO,
          categoryId: CATEGORIA,
          type: 'despesa',
          amount: '45.00',
          description: 'Mercado',
          source: 'assistente',
        });

        expect(await confirmar(socket, proposalId)).toMatchObject({
          ok: false,
          code: 'operacao_inexistente',
        });
        expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
      });

      it('edita no cartão sem gravar e recusa confirmar a versão anterior', async () => {
        const { socket, proposalId } = await comProposta();

        const editado = (await socket.emitWithAck('operation:edit', {
          conversationId: 'c1',
          proposalId,
          values: {
            type: 'despesa',
            amount: '60.00',
            categoryId: CATEGORIA,
            date: '2026-10-01',
            description: 'Feira',
          },
        })) as Ack & { pending?: Fim['pending'] };

        expect(editado.ok).toBe(true);
        expect(editado.pending?.proposal).toMatchObject({
          amount: '60.00',
          date: '2026-10-01',
          description: 'Feira',
        });
        expect(prisma.transaction.create).not.toHaveBeenCalled();

        expect(await confirmar(socket, proposalId)).toMatchObject({
          ok: false,
          code: 'operacao_alterada',
        });
        expect(
          await confirmar(socket, editado.pending?.proposal?.id ?? ''),
        ).toMatchObject({ ok: true });
      });

      it('devolve a mensagem de cada campo reprovado na edição', async () => {
        const { socket, proposalId } = await comProposta();

        const ack = (await socket.emitWithAck('operation:edit', {
          conversationId: 'c1',
          proposalId,
          values: {
            type: 'despesa',
            amount: '-5',
            categoryId: CATEGORIA,
            date: '2026-02-31',
          },
        })) as Ack & { fieldErrors?: Record<string, string[]> };

        expect(ack).toMatchObject({
          ok: false,
          code: 'dados_invalidos',
          message: 'O valor deve ser maior que zero.',
        });
        expect(Object.keys(ack.fieldErrors ?? {}).sort()).toEqual([
          'amount',
          'date',
        ]);
      });

      it('confirma por texto e avisa o fim com o resultado', async () => {
        const { socket } = await comProposta();

        const fim = esperar<Fim>(socket, 'reply:end');
        await enviar(socket, 'pode registrar', 'm2');

        expect(await fim).toEqual({
          id: 'm2',
          pending: null,
          outcome: 'registrado',
          report: null,
          kind: 'sucesso',
        });
        expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
        expect(ollama.chatStream).toHaveBeenCalledTimes(1);
      });

      it('não confirma enquanto uma resposta está em andamento', async () => {
        const { socket, proposalId } = await comProposta();
        ollama.chatStream.mockImplementation(pendurado);
        await enviar(socket, 'quanto gastei este mês com transporte?', 'm2');

        expect(await confirmar(socket, proposalId)).toMatchObject({
          ok: false,
          code: 'ocupado',
        });
        expect(prisma.transaction.create).not.toHaveBeenCalled();
      });

      it('recusa confirmação e edição malformadas', async () => {
        const socket = await conectado();

        expect(
          await socket.emitWithAck('operation:confirm', {
            conversationId: 'c1',
          }),
        ).toMatchObject({ ok: false, code: 'mensagem_invalida' });
        expect(
          await socket.emitWithAck('operation:edit', {
            conversationId: 'c1',
            proposalId: 'p1',
            values: 'tudo',
          }),
        ).toMatchObject({ ok: false, code: 'mensagem_invalida' });
      });
    });

    it('recusa cancelamento com conversa inválida', async () => {
      const socket = await conectado();

      expect(
        await socket.emitWithAck('operation:cancel', {
          conversationId: '../x',
        }),
      ).toMatchObject({ ok: false, code: 'mensagem_invalida' });
    });
  });

  describe('mensagens', () => {
    it('confirma o recebimento e entrega a resposta até o fim, com o tipo da resposta', async () => {
      ollama.chatStream.mockImplementation(() =>
        responder('Texto livre do modelo'),
      );
      const socket = await conectado();
      const pedacos: string[] = [];
      socket.on('reply:chunk', ({ text }: { text: string }) =>
        pedacos.push(text),
      );
      const fim = esperar<{ id: string }>(socket, 'reply:end');

      expect(await enviar(socket, 'me explica como você funciona')).toEqual({
        ok: true,
      });
      expect(await fim).toEqual({
        id: 'm1',
        pending: null,
        outcome: null,
        report: null,
        kind: 'informacao',
      });
      // A ajuda é escrita pelo backend (TCC-028): o texto do modelo não passa.
      expect(pedacos.join('')).toMatch(/^Posso registrar receitas e despesas/);
      expect(pedacos.join('')).not.toContain('Texto livre do modelo');
    });

    it('recusa mensagem inválida sem chamar o modelo', async () => {
      const socket = await conectado();

      expect(await enviar(socket, '   ')).toMatchObject({
        ok: false,
        code: 'mensagem_invalida',
      });
      expect(ollama.chatStream).not.toHaveBeenCalled();
    });

    it('recusa uma segunda mensagem enquanto a primeira é respondida', async () => {
      ollama.chatStream.mockImplementation(pendurado);
      const socket = await conectado();

      await enviar(socket, 'primeira');
      expect(await enviar(socket, 'segunda', 'm2')).toMatchObject({
        ok: false,
        code: 'ocupado',
      });
    });

    it('cancela a resposta a pedido do usuário', async () => {
      ollama.chatStream.mockImplementation(pendurado);
      const socket = await conectado();
      const erro = esperar<{ id: string; code: string }>(socket, 'reply:error');

      await enviar(socket, 'qual a capital da França?');
      await modeloChamado();
      socket.emit('reply:cancel', { id: 'm1' });

      expect(await erro).toMatchObject({ id: 'm1', code: 'cancelado' });
    });

    it('interrompe a geração quando o cliente desconecta', async () => {
      let sinal: AbortSignal | undefined;
      ollama.chatStream.mockImplementation((request: ChatRequest) => {
        sinal = request.signal;
        return pendurado(request);
      });
      const socket = await conectado();

      await enviar(socket, 'qual a capital da França?');
      await modeloChamado();
      socket.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(sinal?.aborted).toBe(true);
    });

    it('recusa mensagem depois que a sessão é encerrada', async () => {
      const socket = await conectado();
      prisma.session.count.mockResolvedValue(0);

      expect(await enviar(socket, 'oi')).toMatchObject({
        ok: false,
        code: 'sessao_expirada',
      });
    });

    it('recusa mensagem depois que o token vence', async () => {
      const socket = await conectar({ token: await token(undefined, 2) });
      await new Promise((resolve) => setTimeout(resolve, 2100));

      expect(await enviar(socket, 'oi')).toMatchObject({
        ok: false,
        code: 'sessao_expirada',
      });
    }, 10_000);

    it('limita mensagens por minuto', async () => {
      ollama.chatStream.mockImplementation(() => responder('ok'));
      const socket = await conectado();

      for (let i = 0; i < 12; i++) {
        const fim = esperar(socket, 'reply:end');
        expect(await enviar(socket, 'oi', `m${i}`)).toEqual({ ok: true });
        await fim;
      }

      expect(await enviar(socket, 'oi', 'm12')).toMatchObject({
        ok: false,
        code: 'limite_excedido',
      });
    });

    it('informa a falha do modelo sem detalhe técnico', async () => {
      ollama.chatStream.mockImplementation(() => {
        throw new LlmError('indisponivel');
      });
      const socket = await conectado();
      const erro = esperar<{ code: string; message: string }>(
        socket,
        'reply:error',
      );

      await enviar(socket, 'oi');

      const recebido = await erro;
      expect(recebido.code).toBe('indisponivel');
      expect(recebido.message).not.toMatch(/ollama|11434|qwen/i);
    });
  });
});
