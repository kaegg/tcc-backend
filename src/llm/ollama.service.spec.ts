import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmError } from './llm.errors';
import type { OllamaSettings } from './ollama.config';
import {
  MAX_PROMPT_CHARS,
  OllamaService,
  type ChatMessage,
} from './ollama.service';

const SETTINGS: OllamaSettings = {
  baseUrl: 'http://ollama:11434',
  model: 'qwen2.5:7b',
  timeoutMs: 1000,
  maxInFlight: 2,
};

const MENSAGEM_SENSIVEL = 'Gastei 4512 reais no cartão final 9876';
const MENSAGENS: ChatMessage[] = [{ role: 'user', content: MENSAGEM_SENSIVEL }];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ndjson = (linhas: unknown[]) =>
  new Response(linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');

/** Imita o fetch real: rejeita com AbortError quando o sinal dispara. */
const pendurado = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });

async function erroDe(promessa: Promise<unknown>): Promise<LlmError> {
  try {
    await promessa;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('a promessa deveria ter falhado');
}

describe('OllamaService', () => {
  let service: OllamaService;
  let fetchMock: jest.SpyInstance;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, nivel)
        .mockImplementation((mensagem: unknown) => {
          logs.push(String(mensagem));
        });
    }
    fetchMock = jest.spyOn(globalThis, 'fetch');
    service = new OllamaService(SETTINGS);
  });

  afterEach(() => jest.restoreAllMocks());

  it('não depende do banco (RNF19)', () => {
    const dependencias = Reflect.getMetadata(
      'design:paramtypes',
      OllamaService,
    ) as unknown[];
    expect(dependencias).not.toContain(PrismaService);
  });

  describe('chat', () => {
    it('envia o modelo configurado, limita a saída e devolve conteúdo e métricas', async () => {
      fetchMock.mockResolvedValue(
        json({
          message: { role: 'assistant', content: '{"intent":"ajuda"}' },
          done: true,
          total_duration: 7_400_000_000,
          load_duration: 5_000_000,
          prompt_eval_count: 183,
          eval_count: 59,
        }),
      );

      const resultado = await service.chat({
        messages: MENSAGENS,
        format: { type: 'object' },
        temperature: 0,
      });

      expect(resultado).toEqual({
        content: '{"intent":"ajuda"}',
        metrics: {
          totalMs: 7400,
          loadMs: 5,
          promptTokens: 183,
          outputTokens: 59,
        },
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://ollama:11434/api/chat');
      expect(init.redirect).toBe('error');
      const corpo = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(corpo).toMatchObject({
        model: 'qwen2.5:7b',
        stream: false,
        format: { type: 'object' },
        options: { temperature: 0, num_predict: 1024 },
      });
    });

    it('trata Ollama fora do ar como indisponível', async () => {
      fetchMock.mockRejectedValue(
        new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }),
      );

      const erro = await erroDe(service.chat({ messages: MENSAGENS }));

      expect(erro.kind).toBe('indisponivel');
      expect(erro.message).not.toMatch(/ECONNREFUSED|ollama:11434/);
    });

    it('trata status de erro do Ollama como indisponível', async () => {
      fetchMock.mockResolvedValue(
        json({ error: "model 'qwen2.5:7b' not found" }, 404),
      );

      const erro = await erroDe(service.chat({ messages: MENSAGENS }));

      expect(erro.kind).toBe('indisponivel');
      expect(logs.join('\n')).toContain('HTTP 404');
    });

    it('esgota o tempo configurado', async () => {
      fetchMock.mockImplementation(pendurado);
      service = new OllamaService({ ...SETTINGS, timeoutMs: 50 });

      const erro = await erroDe(service.chat({ messages: MENSAGENS }));

      expect(erro.kind).toBe('tempo_esgotado');
    });

    it('cancela quando quem chamou aborta', async () => {
      fetchMock.mockImplementation(pendurado);
      const controller = new AbortController();

      const promessa = service.chat({
        messages: MENSAGENS,
        signal: controller.signal,
      });
      controller.abort();

      expect((await erroDe(promessa)).kind).toBe('cancelado');
    });

    it.each([
      ['JSON quebrado', new Response('{nao json')],
      ['sem message.content', json({ done: true })],
      ['corpo acima do limite', new Response('x'.repeat(1024 * 1024 + 1))],
    ])('rejeita resposta inválida: %s', async (_caso, resposta) => {
      fetchMock.mockResolvedValue(resposta);

      const erro = await erroDe(service.chat({ messages: MENSAGENS }));

      expect(erro.kind).toBe('resposta_invalida');
    });

    it('recusa além do limite de chamadas simultâneas e libera a vaga depois', async () => {
      fetchMock.mockImplementation(pendurado);
      const controllers = [new AbortController(), new AbortController()];
      const emAndamento = controllers.map((c) =>
        service.chat({ messages: MENSAGENS, signal: c.signal }),
      );

      expect((await erroDe(service.chat({ messages: MENSAGENS }))).kind).toBe(
        'ocupado',
      );

      controllers.forEach((c) => c.abort());
      await Promise.allSettled(emAndamento);

      fetchMock.mockResolvedValue(json({ message: { content: 'ok' } }));
      await expect(service.chat({ messages: MENSAGENS })).resolves.toEqual(
        expect.objectContaining({ content: 'ok' }),
      );
    });

    it('recusa conversa vazia ou acima do limite antes de chamar o Ollama', async () => {
      await expect(service.chat({ messages: [] })).rejects.toThrow(RangeError);
      await expect(
        service.chat({
          messages: [
            { role: 'user', content: 'x'.repeat(MAX_PROMPT_CHARS + 1) },
          ],
        }),
      ).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('nunca escreve o conteúdo das mensagens no log (RNF08)', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await erroDe(service.chat({ messages: MENSAGENS }));

      fetchMock.mockResolvedValueOnce(json({ error: 'falhou' }, 500));
      await erroDe(service.chat({ messages: MENSAGENS }));

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('4512');
      expect(logs.join('\n')).not.toContain('9876');
    });
  });

  describe('chatStream', () => {
    async function coletar(gerador: AsyncGenerator<string, unknown>) {
      const pedacos: string[] = [];
      let resultado: IteratorResult<string, unknown>;
      while (!(resultado = await gerador.next()).done) {
        pedacos.push(resultado.value);
      }
      return { pedacos, metricas: resultado.value };
    }

    it('entrega os pedaços em ordem e as métricas no fim', async () => {
      fetchMock.mockResolvedValue(
        ndjson([
          { message: { content: 'Olá' }, done: false },
          { message: { content: ', tudo bem?' }, done: false },
          { message: { content: '' }, done: true, eval_count: 3 },
        ]),
      );

      const { pedacos, metricas } = await coletar(
        service.chatStream({ messages: MENSAGENS }),
      );

      expect(pedacos).toEqual(['Olá', ', tudo bem?']);
      expect(metricas).toEqual(expect.objectContaining({ outputTokens: 3 }));
      const corpo = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as { stream: boolean };
      expect(corpo.stream).toBe(true);
    });

    it('trata erro no meio do fluxo como indisponível', async () => {
      fetchMock.mockResolvedValue(
        ndjson([
          { message: { content: 'Olá' }, done: false },
          { error: 'out of memory' },
        ]),
      );

      const gerador = service.chatStream({ messages: MENSAGENS });
      await gerador.next();

      expect((await erroDe(gerador.next())).kind).toBe('indisponivel');
    });

    it('rejeita fluxo que termina sem done', async () => {
      fetchMock.mockResolvedValue(
        ndjson([{ message: { content: 'Olá' }, done: false }]),
      );

      const gerador = service.chatStream({ messages: MENSAGENS });
      await gerador.next();

      expect((await erroDe(gerador.next())).kind).toBe('resposta_invalida');
    });

    it('libera a vaga quando o consumidor para no meio', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          ndjson([
            { message: { content: 'a' }, done: false },
            { message: { content: 'b' }, done: true },
          ]),
        ),
      );

      for (let i = 0; i < SETTINGS.maxInFlight + 1; i++) {
        for await (const pedaco of service.chatStream({
          messages: MENSAGENS,
        })) {
          expect(pedaco).toBe('a');
          break;
        }
      }
    });
  });

  describe('probe', () => {
    it('fica ok quando o modelo configurado está instalado', async () => {
      fetchMock.mockResolvedValue(
        json({ models: [{ name: 'qwen2.5:7b', model: 'qwen2.5:7b' }] }),
      );

      const resultado = await service.probe();

      expect(resultado.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://ollama:11434/api/tags',
        expect.anything(),
      );
      expect(typeof resultado.latencyMs).toBe('number');
    });

    it('fica indisponível quando falta o modelo', async () => {
      fetchMock.mockResolvedValue(
        json({ models: [{ name: 'llama3:latest' }] }),
      );

      expect(await service.probe()).toEqual({ status: 'indisponivel' });
      expect(logs.join('\n')).toContain('não está instalado');
    });

    it('registra a queda uma vez só, não a cada verificação', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await service.probe();
      await service.probe();
      await service.probe();

      expect(logs.filter((l) => l.includes('indisponível'))).toHaveLength(1);
    });
  });
});
