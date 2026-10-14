import { Injectable, Logger } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import { LlmError } from '../llm/llm.errors';
import {
  MAX_PROMPT_CHARS,
  OllamaService,
  type ChatMessage,
} from '../llm/ollama.service';
import { ConversationMemory } from './conversation-memory';
import {
  isCancelCommand,
  isShortAnswer,
  looksLikeQuestion,
} from './extraction/commands';
import {
  isComplete,
  missingFields,
  readFacts,
  updateRegistration,
  type RegistrationState,
} from './extraction/registration';
import {
  FIELD_NAME,
  composeRegistrationReply,
} from './extraction/registration-reply';
import { normalize } from './extraction/text';
import { buildTransactionDraft } from './extraction/transaction-draft';
import {
  emptyEntities,
  type EntityName,
  type InterpretationContext,
} from './interpretation/entities';
import { findIntent } from './interpretation/intents';
import {
  buildOutputSchema,
  buildSystemPrompt,
  fromModelOutput,
  parseModelOutput,
  stripControlChars,
  toModelOutput,
  type Interpretation,
} from './interpretation/interpretation';
import { JsonFieldStreamer } from './interpretation/json-field-streamer';
import { referenceDate } from './interpretation/reference-date';
import { PendingOperations, type PendingOperation } from './pending-operations';

export interface PendingSummary {
  /** Nomes dos campos que ainda faltam ou estão em dúvida, em português. */
  missing: string[];
  ready: boolean;
}

export const CANCELLED_REPLY =
  'Tudo bem, cancelei o lançamento em andamento. Nada foi registrado.';
export const NOTHING_TO_CANCEL_REPLY =
  'Não há nenhum lançamento em andamento para cancelar.';
export const REPLACED_NOTICE =
  'O lançamento anterior, que ainda não tinha sido registrado, foi substituído por este.';

const REGISTER = 'registrar_lancamento';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly memory = new ConversationMemory();
  private readonly pending = new PendingOperations();
  now: () => Date = () => new Date();

  constructor(
    private readonly llm: OllamaService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * Entrega o texto ao usuário e devolve, no fim, a interpretação validada. O
   * LLM só interpreta (RNF19): nada aqui grava. Um lançamento só fica pronto
   * para confirmação (`transactionDraft`) sem dado ausente nem ambíguo.
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
    const normalized = normalize(content);
    const pending = this.pending.get(userId, conversationId);

    if (isCancelCommand(normalized)) {
      const reply = pending ? CANCELLED_REPLY : NOTHING_TO_CANCEL_REPLY;
      if (pending) this.pending.delete(userId, conversationId);
      const result = plainReply('cancelar', reply);
      yield reply;
      this.remember(userId, conversationId, content, result);
      return result;
    }

    // Resposta curta a uma pergunta do assistente ("45", "ontem",
    // "alimentação") é lida sem o modelo: em CPU isso poupa vários segundos e
    // não depende de o modelo reconhecer a continuação.
    if (
      pending &&
      isShortAnswer(normalized) &&
      !looksLikeQuestion(normalized)
    ) {
      const state = updateRegistration(pending.state, content, null, context);
      if (changed(pending.state, state)) {
        const result = this.register(
          userId,
          conversationId,
          pending,
          state,
          context,
          false,
        );
        yield result.reply;
        this.remember(userId, conversationId, content, result);
        return result;
      }
    }

    const { output, raw, streamed } = yield* this.askModel(
      userId,
      conversationId,
      content,
      context,
      signal,
    );
    if (!output) {
      // O conteúdo não vai para o log: traz o que o usuário escreveu (RNF08).
      this.logger.warn(
        `Saída do LLM fora do esquema descartada (${raw.length} caracteres).`,
      );
      throw new LlmError('resposta_invalida');
    }

    let result: Interpretation;
    if (output.intent.name === REGISTER) {
      const base = this.continues(pending, normalized, context)
        ? pending
        : null;
      const state = updateRegistration(
        base?.state ?? null,
        content,
        output.entities,
        context,
      );
      result = this.register(
        userId,
        conversationId,
        base,
        state,
        context,
        output.ambiguous,
      );
      if (pending && !base) result.reply = `${REPLACED_NOTICE} ${result.reply}`;
      yield result.reply;
    } else {
      result = fromModelOutput(output, context);
      if (!streamed) yield result.reply;
      // Outro assunto não descarta o lançamento: ele espera, e o usuário é
      // lembrado de como continuar ou desistir.
      if (pending) {
        const reminder = pendingReminder(pending.state);
        result.reply = `${result.reply}\n\n${reminder}`;
        yield `\n\n${reminder}`;
      }
    }

    this.logger.debug(
      `Intenção ${result.intent}; faltando: ${result.missingFields.join(', ') || 'nada'}; esclarecer: ${result.clarifications.map((item) => item.field).join(', ') || 'nada'}.`,
    );
    this.remember(userId, conversationId, content, result);
    return result;
  }

  pendingSummary(
    userId: string,
    conversationId: string,
  ): PendingSummary | null {
    const operation = this.pending.get(userId, conversationId);
    if (!operation) return null;
    return {
      missing: openFields(operation.state).map((field) => FIELD_NAME[field]),
      ready: isComplete(operation.state),
    };
  }

  /** Cancelamento pelo botão da interface, sem mensagem digitada. */
  cancelPending(userId: string, conversationId: string): string {
    const removed = this.pending.delete(userId, conversationId);
    const reply = removed ? CANCELLED_REPLY : NOTHING_TO_CANCEL_REPLY;
    this.remember(
      userId,
      conversationId,
      'cancelar',
      plainReply('cancelar', reply),
    );
    return reply;
  }

  /**
   * Chama o modelo e repassa o texto da resposta enquanto chega — exceto nas
   * intenções em que o backend escreve a resposta. A intenção é o primeiro
   * campo do JSON; até ela chegar, o texto fica guardado.
   */
  private async *askModel(
    userId: string,
    conversationId: string,
    content: string,
    context: InterpretationContext,
    signal: AbortSignal,
  ): AsyncGenerator<
    string,
    {
      output: ReturnType<typeof parseModelOutput>;
      raw: string;
      streamed: boolean;
    },
    undefined
  > {
    const messages = fitPrompt([
      { role: 'system', content: buildSystemPrompt(context) },
      ...this.memory.history(userId, conversationId),
      { role: 'user', content },
    ]);

    const intentField = new JsonFieldStreamer('intent');
    const replyField = new JsonFieldStreamer('reply');
    let intentName = '';
    let allowed: boolean | null = null;
    let held = '';
    let raw = '';
    let streamed = false;

    for await (const chunk of this.llm.chatStream({
      messages,
      signal,
      format: buildOutputSchema(context),
      temperature: 0,
    })) {
      raw += chunk;
      intentName += intentField.push(chunk);
      const text = stripControlChars(replyField.push(chunk));

      if (allowed === null && intentField.done) {
        allowed = findIntent(intentName)?.modelReply !== false;
      }
      if (allowed === null) {
        held += text;
        continue;
      }
      const out = allowed ? held + text : '';
      held = '';
      if (out) {
        streamed = true;
        yield out;
      }
    }

    return { output: parseModelOutput(raw), raw, streamed };
  }

  /**
   * A mensagem continua o lançamento em andamento ou começa outro? Se ainda
   * falta dado, é continuação. Se ele já estava completo, um novo relato com
   * valor ("gastei 30 no uber") é outro lançamento; sem isso, é correção.
   */
  private continues(
    pending: PendingOperation | null,
    normalized: string,
    context: InterpretationContext,
  ): boolean {
    if (!pending) return false;
    if (!isComplete(pending.state)) return true;
    const facts = readFacts(normalized, context.referenceDate);
    return !(facts.typeHint !== null && facts.amounts.length > 0);
  }

  private register(
    userId: string,
    conversationId: string,
    previous: PendingOperation | null,
    state: RegistrationState,
    context: InterpretationContext,
    modelAmbiguous: boolean,
  ): Interpretation {
    const attempts = nextAttempts(previous, state);
    this.pending.set(userId, conversationId, {
      intent: REGISTER,
      state,
      attempts,
    });

    return {
      intent: REGISTER,
      entities: state.entities,
      missingFields: missingFields(state),
      clarifications: state.clarifications,
      defaults: state.defaults,
      ambiguous: modelAmbiguous || state.clarifications.length > 0,
      reply: composeRegistrationReply(state, context, attempts),
      transactionDraft: buildTransactionDraft(state),
    };
  }

  private remember(
    userId: string,
    conversationId: string,
    content: string,
    result: Interpretation,
  ): void {
    this.memory.append(
      userId,
      conversationId,
      { role: 'user', content },
      { role: 'assistant', content: toModelOutput(result) },
    );
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

function plainReply(intent: string, reply: string): Interpretation {
  return {
    intent,
    entities: emptyEntities(),
    missingFields: [],
    clarifications: [],
    defaults: [],
    ambiguous: false,
    reply,
    transactionDraft: null,
  };
}

function openFields(state: RegistrationState): EntityName[] {
  return [
    ...state.clarifications.map((item) => item.field),
    ...missingFields(state),
  ];
}

function changed(before: RegistrationState, after: RegistrationState): boolean {
  return (
    JSON.stringify([before.entities, before.clarifications]) !==
    JSON.stringify([after.entities, after.clarifications])
  );
}

/** Conta quantas mensagens seguidas cada campo continuou sem resposta. */
function nextAttempts(
  previous: PendingOperation | null,
  state: RegistrationState,
): Partial<Record<EntityName, number>> {
  if (!previous) return {};
  const before = new Set(openFields(previous.state));
  const attempts: Partial<Record<EntityName, number>> = {};
  for (const field of openFields(state)) {
    attempts[field] = before.has(field)
      ? (previous.attempts[field] ?? 0) + 1
      : 0;
  }
  return attempts;
}

function pendingReminder(state: RegistrationState): string {
  const open = openFields(state);
  if (open.length === 0) {
    return 'Lembrete: o lançamento em andamento está completo e aguarda confirmação. Para descartá-lo, diga “cancelar”.';
  }
  const names = open.map((field) => FIELD_NAME[field]);
  return `Lembrete: o lançamento em andamento ainda precisa de ${names.join(' e ')}. Responda quando quiser ou diga “cancelar”.`;
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
