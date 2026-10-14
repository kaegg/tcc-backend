import { Inject, Injectable, Logger } from '@nestjs/common';
import { describeError } from '../common/utils/describe-error';
import { redactSecrets } from '../common/utils/redact';
import { LlmError } from './llm.errors';
import { OLLAMA_SETTINGS, type OllamaSettings } from './ollama.config';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** `'json'` ou um JSON Schema; o Ollama restringe a geração a ele. */
  format?: 'json' | Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatMetrics {
  totalMs?: number;
  loadMs?: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface ChatResult {
  content: string;
  metrics: ChatMetrics;
}

export interface ProbeResult {
  status: 'ok' | 'indisponivel';
  latencyMs?: number;
}

const ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant']);

export const MAX_PROMPT_CHARS = 16_000;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ERROR_LOG_CHARS = 200;
const PROBE_TIMEOUT_MS = 2000;

interface CallContext {
  signal: AbortSignal;
  timeout: AbortSignal;
  caller?: AbortSignal;
  startedAt: number;
}

/**
 * Única porta de saída do backend para o LLM. Não recebe o PrismaService de
 * propósito (RNF19): o modelo só interpreta, e quem grava é o serviço de
 * negócio, depois da confirmação do usuário. Por isso a chamada ao LLM nunca
 * deve acontecer dentro de uma transação do banco.
 */
@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private inFlight = 0;
  private lastProbeOk: boolean | undefined;

  constructor(
    @Inject(OLLAMA_SETTINGS) private readonly settings: OllamaSettings,
  ) {}

  get model(): string {
    return this.settings.model;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    assertPrompt(request.messages);
    this.acquire();
    const context = this.createContext(request.signal);

    try {
      const response = await this.post(request, false, context);
      const body = parseJson(await readCapped(response.body));

      const content = (body as { message?: { content?: unknown } }).message
        ?.content;
      if (typeof content !== 'string') {
        throw new LlmError('resposta_invalida');
      }

      return { content, metrics: readMetrics(body) };
    } catch (error) {
      throw this.toLlmError(error, context);
    } finally {
      this.release();
    }
  }

  /**
   * Entrega o texto conforme é gerado e devolve as métricas ao terminar.
   * Consumir com `for await`: sair do laço chama `return()`, que fecha a
   * conexão — e o Ollama interrompe a geração quando o cliente desconecta.
   */
  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<string, ChatMetrics, undefined> {
    assertPrompt(request.messages);
    this.acquire();
    const context = this.createContext(request.signal);

    try {
      const response = await this.post(request, true, context);
      if (!response.body) throw new LlmError('resposta_invalida');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let bytes = 0;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) buffer += decoder.decode();
          else {
            bytes += value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              throw new LlmError('resposta_invalida');
            }
            buffer += decoder.decode(value, { stream: true });
          }

          const lines = buffer.split('\n');
          buffer = done ? '' : (lines.pop() ?? '');

          for (const line of lines) {
            if (!line.trim()) continue;
            const chunk = this.parseStreamLine(line);
            if (chunk.content) yield chunk.content;
            if (chunk.done) return readMetrics(chunk.raw);
          }

          if (done) throw new LlmError('resposta_invalida');
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      throw this.toLlmError(error, context);
    } finally {
      this.release();
    }
  }

  async probe(): Promise<ProbeResult> {
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.settings.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }

      const body = parseJson(await readCapped(response.body));
      if (!hasModel(body, this.settings.model)) {
        throw new Error(`modelo ${this.settings.model} não está instalado`);
      }

      this.reportProbe(true);
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.reportProbe(false, error);
      return { status: 'indisponivel' };
    }
  }

  private acquire(): void {
    if (this.inFlight >= this.settings.maxInFlight) {
      this.logger.warn(
        `Limite de ${this.settings.maxInFlight} chamadas simultâneas ao Ollama atingido.`,
      );
      throw new LlmError('ocupado');
    }
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
  }

  private createContext(caller?: AbortSignal): CallContext {
    const timeout = AbortSignal.timeout(this.settings.timeoutMs);
    return {
      signal: caller ? AbortSignal.any([caller, timeout]) : timeout,
      timeout,
      caller,
      startedAt: Date.now(),
    };
  }

  private async post(
    request: ChatRequest,
    stream: boolean,
    context: CallContext,
  ): Promise<Response> {
    const response = await fetch(`${this.settings.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.model,
        messages: request.messages.map(({ role, content }) => ({
          role,
          content,
        })),
        stream,
        format: request.format,
        options: {
          temperature: request.temperature,
          num_predict: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: context.signal,
      // Um redirecionamento levaria o prompt para outro host, contornando a
      // validação de rede local feita no boot (RNF06).
      redirect: 'error',
    });

    if (!response.ok) {
      const detail = await readCapped(response.body).catch(() => '');
      this.logger.error(
        redactSecrets(
          `Ollama respondeu HTTP ${response.status} para o modelo ` +
            `${this.settings.model}: ${detail.slice(0, MAX_ERROR_LOG_CHARS)}`,
        ),
      );
      throw new LlmError('indisponivel');
    }

    return response;
  }

  private parseStreamLine(line: string): {
    content?: string;
    done: boolean;
    raw: unknown;
  } {
    const raw = parseJson(line) as {
      error?: unknown;
      done?: unknown;
      message?: { content?: unknown };
    };

    if (typeof raw.error === 'string') {
      this.logger.error(
        redactSecrets(
          `Ollama interrompeu a geração: ${raw.error.slice(0, MAX_ERROR_LOG_CHARS)}`,
        ),
      );
      throw new LlmError('indisponivel');
    }

    const content = raw.message?.content;
    if (content !== undefined && typeof content !== 'string') {
      throw new LlmError('resposta_invalida');
    }

    return { content, done: raw.done === true, raw };
  }

  /**
   * O conteúdo das mensagens nunca entra no log: são dados financeiros do
   * usuário (RNF08). Só vão o tipo da falha, o modelo e a duração.
   */
  private toLlmError(error: unknown, context: CallContext): LlmError {
    let result: LlmError;
    if (error instanceof LlmError) result = error;
    else if (context.timeout.aborted) result = new LlmError('tempo_esgotado');
    else if (context.caller?.aborted) result = new LlmError('cancelado');
    else result = new LlmError('indisponivel');

    if (result.kind === 'cancelado') return result;

    const detail = error instanceof LlmError ? '' : `: ${describeError(error)}`;
    this.logger.warn(
      redactSecrets(
        `Chamada ao Ollama falhou (${result.kind}, modelo ` +
          `${this.settings.model}, ${Date.now() - context.startedAt} ms)${detail}`,
      ),
    );

    return result;
  }

  private reportProbe(ok: boolean, error?: unknown): void {
    if (ok === this.lastProbeOk) return;
    this.lastProbeOk = ok;

    if (ok) this.logger.log('Ollama disponível.');
    else {
      this.logger.error(
        redactSecrets(`Ollama indisponível: ${describeError(error)}`),
      );
    }
  }
}

function assertPrompt(messages: ChatMessage[]): void {
  if (messages.length === 0) {
    throw new RangeError('A conversa enviada ao LLM está vazia.');
  }

  let total = 0;
  for (const message of messages) {
    if (!ROLES.has(message.role) || typeof message.content !== 'string') {
      throw new RangeError('Mensagem inválida para o LLM.');
    }
    total += message.content.length;
  }

  if (total > MAX_PROMPT_CHARS) {
    throw new RangeError(
      `A conversa enviada ao LLM passa de ${MAX_PROMPT_CHARS} caracteres.`,
    );
  }
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();

      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new LlmError('resposta_invalida');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseJson(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LlmError('resposta_invalida');
  }
  if (typeof value !== 'object' || value === null) {
    throw new LlmError('resposta_invalida');
  }
  return value;
}

function readMetrics(raw: unknown): ChatMetrics {
  const body = raw as Record<string, unknown>;
  const ns = (key: string) =>
    typeof body[key] === 'number' ? Math.round(body[key] / 1e6) : undefined;
  const count = (key: string) =>
    typeof body[key] === 'number' ? body[key] : undefined;

  return {
    totalMs: ns('total_duration'),
    loadMs: ns('load_duration'),
    promptTokens: count('prompt_eval_count'),
    outputTokens: count('eval_count'),
  };
}

function hasModel(raw: unknown, model: string): boolean {
  const models = (raw as { models?: unknown }).models;
  if (!Array.isArray(models)) return false;

  const wanted = model.includes(':') ? model : `${model}:latest`;
  return models.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      ((entry as { name?: unknown }).name === wanted ||
        (entry as { model?: unknown }).model === wanted),
  );
}
