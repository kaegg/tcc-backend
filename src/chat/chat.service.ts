import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import type { FieldErrors } from '../common/validation-exception.factory';
import { LlmError } from '../llm/llm.errors';
import {
  MAX_PROMPT_CHARS,
  OllamaService,
  type ChatMessage,
} from '../llm/ollama.service';
import { ReportsService } from '../reports/reports.service';
import type { TransactionResponseDto } from '../transactions/dto/transaction-response.dto';
import { TransactionsService } from '../transactions/transactions.service';
import type { ChatErrorCode } from './chat.protocol';
import { ConversationMemory } from './conversation-memory';
import {
  isCancelCommand,
  isConfirmCommand,
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
  composeRegisteredReply,
  composeRegistrationReply,
} from './extraction/registration-reply';
import { extractPeriod, type PeriodReading } from './extraction/periods';
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
import { PendingQueries } from './pending-queries';
import { stateFromEdit, toProposal, type Proposal } from './proposal';
import {
  PERIOD_EXAMPLES,
  checkPeriod,
  composeReportReply,
  periodQuestion,
  readQuery,
  type QueryIntent,
  type ReportQuery,
} from './report-query';

export interface PendingSummary {
  /** Nomes dos campos que ainda faltam ou estão em dúvida, em português. */
  missing: string[];
  ready: boolean;
  /** Presente quando o lançamento está completo e pode ser confirmado. */
  proposal: Proposal | null;
}

export interface OperationFailure {
  ok: false;
  code: Extract<
    ChatErrorCode,
    | 'operacao_inexistente'
    | 'operacao_alterada'
    | 'operacao_incompleta'
    | 'dados_invalidos'
  >;
  fieldErrors?: FieldErrors;
}

export type ConfirmResult =
  | { ok: true; reply: string; transaction: TransactionResponseDto }
  | OperationFailure;

export type EditResult =
  { ok: true; pending: PendingSummary } | OperationFailure;

export const CANCELLED_REPLY =
  'Tudo bem, cancelei o lançamento em andamento. Nada foi registrado.';
export const NOTHING_TO_CANCEL_REPLY =
  'Não há nenhum lançamento em andamento para cancelar.';
export const EDITED_MESSAGE = 'Corrigi os dados do lançamento no cartão.';
export const REPLACED_NOTICE =
  'O lançamento anterior, que ainda não tinha sido registrado, foi substituído por este.';

const REGISTER = 'registrar_lancamento';
const QUERY_INTENTS: readonly string[] = [
  'consultar_relatorio',
  'obter_resumo',
] satisfies QueryIntent[];

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly memory = new ConversationMemory();
  private readonly pending = new PendingOperations();
  private readonly queries = new PendingQueries();
  now: () => Date = () => new Date();

  constructor(
    private readonly llm: OllamaService,
    private readonly categories: CategoriesService,
    private readonly transactions: TransactionsService,
    private readonly reports: ReportsService,
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
    const waiting = this.queries.get(userId, conversationId);

    if (isCancelCommand(normalized)) {
      this.queries.delete(userId, conversationId);
      const reply = pending ? CANCELLED_REPLY : NOTHING_TO_CANCEL_REPLY;
      if (pending) this.pending.delete(userId, conversationId);
      const result = plainReply('cancelar', reply);
      if (pending) result.outcome = 'cancelado';
      yield reply;
      this.remember(userId, conversationId, content, result);
      return result;
    }

    // "pode registrar" só confirma o que já está completo e na tela; sem isso,
    // o texto segue como qualquer outra mensagem.
    if (pending && isComplete(pending.state) && isConfirmCommand(normalized)) {
      const committed = await this.commit(
        userId,
        conversationId,
        pending,
        context.referenceDate,
      );
      const result = committed.ok
        ? {
            ...plainReply('confirmar', committed.reply),
            outcome: 'registrado' as const,
          }
        : plainReply('confirmar', commitFailureReply(committed));
      yield result.reply;
      this.remember(userId, conversationId, content, result);
      return result;
    }

    // A resposta a "de qual período?" ("este mês", "setembro") também é lida
    // sem o modelo. A consulta que espera é sempre a última pergunta feita:
    // qualquer outra intenção a descarta.
    if (
      waiting &&
      isShortAnswer(normalized) &&
      !looksLikeQuestion(normalized)
    ) {
      const reading = extractPeriod(normalized, context.referenceDate);
      if (reading.kind !== 'ausente') {
        const result = await this.answerQuery(
          userId,
          conversationId,
          {
            intent: waiting.intent,
            normalized,
            model: null,
            previous: waiting,
          },
          reading,
          context,
        );
        yield* this.withReminder(result, pending);
        this.remember(userId, conversationId, content, result);
        return result;
      }
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
    if (QUERY_INTENTS.includes(output.intent.name)) {
      result = await this.answerQuery(
        userId,
        conversationId,
        {
          intent: output.intent.name as QueryIntent,
          normalized,
          model: output.entities,
          previous: waiting,
        },
        extractPeriod(normalized, context.referenceDate),
        context,
      );
      yield* this.withReminder(result, pending);
    } else if (output.intent.name === REGISTER) {
      this.queries.delete(userId, conversationId);
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
      this.queries.delete(userId, conversationId);
      result = fromModelOutput(output, context);
      if (!streamed) yield result.reply;
      yield* this.withReminder(result, pending, false);
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
      proposal: toProposal(operation),
    };
  }

  /** Confirmação pelo botão do cartão, para a versão que o usuário vê. */
  async confirmPending(
    userId: string,
    conversationId: string,
    proposalId: string,
  ): Promise<ConfirmResult> {
    const operation = this.pending.get(userId, conversationId);
    if (!operation) return { ok: false, code: 'operacao_inexistente' };
    if (operation.id !== proposalId) {
      return { ok: false, code: 'operacao_alterada' };
    }

    const result = await this.commit(
      userId,
      conversationId,
      operation,
      referenceDate(this.now()).date,
    );
    if (result.ok) {
      this.remember(userId, conversationId, 'confirmar', {
        ...plainReply('confirmar', result.reply),
        outcome: 'registrado',
      });
    }
    return result;
  }

  /**
   * Correção feita pelo usuário no próprio cartão. Substitui os dados do
   * lançamento pendente, que continua aguardando confirmação: editar não grava.
   */
  async editPending(
    userId: string,
    conversationId: string,
    proposalId: string,
    values: Record<string, unknown>,
  ): Promise<EditResult> {
    const operation = this.pending.get(userId, conversationId);
    if (!operation) return { ok: false, code: 'operacao_inexistente' };
    if (operation.id !== proposalId) {
      return { ok: false, code: 'operacao_alterada' };
    }

    const context = await this.buildContext();
    const edited = stateFromEdit(values, context);
    if ('fieldErrors' in edited) {
      return {
        ok: false,
        code: 'dados_invalidos',
        fieldErrors: edited.fieldErrors,
      };
    }
    if (this.pending.get(userId, conversationId)?.id !== proposalId) {
      return { ok: false, code: 'operacao_alterada' };
    }

    const result = this.register(
      userId,
      conversationId,
      null,
      edited.state,
      context,
      false,
    );
    this.remember(userId, conversationId, EDITED_MESSAGE, result);
    return {
      ok: true,
      pending: this.pendingSummary(userId, conversationId) as PendingSummary,
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
   * Consulta de relatório (TCC-027). O período vem do texto e os números, do
   * `ReportsService.overview` — o mesmo serviço e a mesma validação de período
   * da tela de relatórios, então chatbot e tela dão o mesmo número (RNF12).
   * Sem período seguro, pergunta e guarda o que foi pedido.
   */
  private async answerQuery(
    userId: string,
    conversationId: string,
    asked: {
      intent: QueryIntent;
      normalized: string;
      model: Record<string, unknown> | null;
      previous: ReportQuery | null;
    },
    reading: PeriodReading,
    context: InterpretationContext,
  ): Promise<Interpretation> {
    const query = readQuery(
      asked.intent,
      asked.normalized,
      asked.model,
      context,
      asked.previous,
    );
    const entities = {
      ...emptyEntities(),
      type:
        query.category?.type ??
        (query.focus === 'despesa' || query.focus === 'receita'
          ? query.focus
          : null),
      category: query.category
        ? { id: query.category.id, name: query.category.name }
        : null,
    };
    const base = { ...plainReply(query.intent, ''), entities };

    let question: string | null = null;
    if (reading.kind !== 'resolvido') {
      question = periodQuestion(reading, context.referenceDate);
    } else {
      const invalid = checkPeriod(reading.period);
      if (invalid) {
        question = `Não consigo consultar esse período: ${invalid} ${PERIOD_EXAMPLES}`;
      }
    }
    if (question !== null || reading.kind !== 'resolvido') {
      this.queries.set(userId, conversationId, query);
      return {
        ...base,
        missingFields: ['periodStart', 'periodEnd'],
        ambiguous: reading.kind !== 'ausente',
        reply: question as string,
      };
    }

    this.queries.delete(userId, conversationId);
    const report = await this.reports.overview(userId, reading.period);
    return {
      ...base,
      entities: {
        ...entities,
        periodStart: reading.period.from,
        periodEnd: reading.period.to,
      },
      reply: composeReportReply(query, report, context.referenceDate),
      report: reading.period,
    };
  }

  /**
   * Outro assunto não descarta o lançamento em andamento: ele espera, e o
   * usuário é lembrado de como continuar ou desistir.
   */
  private *withReminder(
    result: Interpretation,
    pending: PendingOperation | null,
    includeReply = true,
  ): Generator<string, void, undefined> {
    if (includeReply) yield result.reply;
    if (!pending) return;
    const reminder = pendingReminder(pending.state);
    result.reply = `${result.reply}\n\n${reminder}`;
    yield `\n\n${reminder}`;
  }

  /**
   * Grava pelo mesmo serviço do formulário (RNF12), com o rascunho validado
   * pelo mesmo DTO. O LLM nunca chega aqui: só o estado do servidor (RNF19).
   *
   * O pendente sai antes da gravação, para um segundo clique ou outra aba não
   * gravarem o mesmo lançamento duas vezes. Se a gravação falha, ele volta.
   */
  private async commit(
    userId: string,
    conversationId: string,
    operation: PendingOperation,
    reference: string,
  ): Promise<
    | { ok: true; reply: string; transaction: TransactionResponseDto }
    | OperationFailure
  > {
    const draft = buildTransactionDraft(operation.state);
    if (!draft) return { ok: false, code: 'operacao_incompleta' };

    this.pending.delete(userId, conversationId);
    try {
      const transaction = await this.transactions.create(
        userId,
        draft,
        'assistente',
      );
      return {
        ok: true,
        reply: composeRegisteredReply(operation.state, reference),
        transaction,
      };
    } catch (error) {
      if (!this.pending.get(userId, conversationId)) {
        this.pending.set(userId, conversationId, operation);
      }
      // Categoria desativada entre a proposta e a confirmação.
      if (error instanceof BadRequestException) {
        const body = error.getResponse() as { fieldErrors?: FieldErrors };
        return {
          ok: false,
          code: 'dados_invalidos',
          fieldErrors: body.fieldErrors ?? {},
        };
      }
      throw error;
    }
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

function commitFailureReply(failure: OperationFailure): string {
  const reason = Object.values(failure.fieldErrors ?? {}).flat()[0];
  return reason
    ? `Não consegui registrar: ${reason} Corrija pelo botão Editar do cartão ou diga “cancelar”.`
    : 'Não consegui registrar o lançamento. Confira os dados e tente de novo.';
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
