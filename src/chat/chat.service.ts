import { Injectable, Logger } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import { LlmError } from '../llm/llm.errors';
import {
  MAX_PROMPT_CHARS,
  OllamaService,
  type ChatMessage,
} from '../llm/ollama.service';
import { ConversationMemory } from './conversation-memory';
import type { InterpretationContext } from './interpretation/entities';
import {
  buildOutputSchema,
  buildSystemPrompt,
  parseInterpretation,
  stripControlChars,
  toModelOutput,
  type Interpretation,
} from './interpretation/interpretation';
import { JsonFieldStreamer } from './interpretation/json-field-streamer';
import { referenceDate } from './interpretation/reference-date';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly memory = new ConversationMemory();
  now: () => Date = () => new Date();

  constructor(
    private readonly llm: OllamaService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * Entrega o texto ao usuário enquanto ele é gerado e devolve, no fim, a
   * interpretação validada. O LLM só interpreta (RNF19): nada aqui grava.
   *
   * O histórico só recebe a troca completa e validada: uma resposta cancelada,
   * com falha ou fora do esquema não entra, para o modelo não continuar dela.
   */
  async *streamReply(
    userId: string,
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): AsyncGenerator<string, Interpretation, undefined> {
    const context = await this.buildContext();
    const userMessage: ChatMessage = { role: 'user', content };
    const messages = fitPrompt([
      { role: 'system', content: buildSystemPrompt(context) },
      ...this.memory.history(userId, conversationId),
      userMessage,
    ]);

    const replyField = new JsonFieldStreamer('reply');
    let output = '';
    let streamed = '';

    for await (const chunk of this.llm.chatStream({
      messages,
      signal,
      format: buildOutputSchema(context),
      temperature: 0,
    })) {
      output += chunk;
      const text = stripControlChars(replyField.push(chunk));
      if (text) {
        streamed += text;
        yield text;
      }
    }

    const interpretation = parseInterpretation(output, context);
    if (!interpretation) {
      // O conteúdo não vai para o log: traz o que o usuário escreveu (RNF08).
      this.logger.warn(
        `Saída do LLM fora do esquema descartada (${output.length} caracteres).`,
      );
      throw new LlmError('resposta_invalida');
    }

    if (!streamed) yield interpretation.reply;

    this.logger.debug(
      `Intenção ${interpretation.intent}; faltando: ${interpretation.missingFields.join(', ') || 'nada'}; ambígua: ${interpretation.ambiguous}.`,
    );

    this.memory.append(userId, conversationId, userMessage, {
      role: 'assistant',
      content: toModelOutput(interpretation),
    });

    return interpretation;
  }

  private async buildContext(): Promise<InterpretationContext> {
    const { date, weekday } = referenceDate(this.now());
    return {
      referenceDate: date,
      referenceWeekday: weekday,
      categories: await this.categories.findAll(),
    };
  }
}

/** Descarta as falas mais antigas até caber no teto do serviço do LLM. */
function fitPrompt(messages: ChatMessage[]): ChatMessage[] {
  const [system, ...rest] = messages;
  const size = (list: ChatMessage[]) =>
    list.reduce((total, message) => total + message.content.length, 0);

  while (rest.length > 1 && size([system, ...rest]) > MAX_PROMPT_CHARS) {
    rest.shift();
  }
  return [system, ...rest];
}
