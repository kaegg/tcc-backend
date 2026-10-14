import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import type { App } from 'supertest/types';
import { parseCorsOrigins } from './../src/common/cors-origins';
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

type Ack = { ok: boolean; code?: string; message?: string };

function* responder(...pedacos: string[]) {
  for (const pedaco of pedacos) yield pedaco;
  return {};
}

/** Fica gerando até ser cancelado, como uma resposta longa do modelo. */
async function* pendurado(request: ChatRequest) {
  yield 'começo';
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

  describe('mensagens', () => {
    it('confirma o recebimento e entrega a resposta em pedaços até o fim', async () => {
      ollama.chatStream.mockImplementation(() =>
        responder('Olá', ', tudo bem?'),
      );
      const socket = await conectado();
      const pedacos: string[] = [];
      socket.on('reply:chunk', ({ text }: { text: string }) =>
        pedacos.push(text),
      );
      const fim = esperar<{ id: string }>(socket, 'reply:end');

      expect(await enviar(socket, 'oi')).toEqual({ ok: true });
      expect(await fim).toEqual({ id: 'm1' });
      expect(pedacos).toEqual(['Olá', ', tudo bem?']);
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

      const primeiro = esperar(socket, 'reply:chunk');
      await enviar(socket, 'oi');
      await primeiro;
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

      const primeiro = esperar(socket, 'reply:chunk');
      await enviar(socket, 'oi');
      await primeiro;
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
