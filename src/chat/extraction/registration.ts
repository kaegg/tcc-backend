import type { TransactionType } from '../../generated/prisma/enums';
import {
  comparable,
  emptyEntities,
  sanitizeEntities,
  type Entities,
  type EntityName,
  type InterpretationContext,
} from '../interpretation/entities';
import { centsToAmount, extractAmounts, type AmountMention } from './amounts';
import { extractDates, type DateMention } from './dates';
import { mask, normalize } from './text';
import { detectTypeHint, readTypeAnswer } from './type-hint';

export type ClarificationReason =
  | 'multiplos_valores'
  | 'tipo_conflitante'
  | 'multiplas_datas'
  | 'data_imprecisa'
  | 'data_invalida';

export interface Clarification {
  field: EntityName;
  reason: ClarificationReason;
  /** Valores (`"45.00"`) ou datas (`AAAA-MM-DD`) entre os quais escolher. */
  options: string[];
}

export interface RegistrationState {
  entities: Entities;
  clarifications: Clarification[];
  /** Campos preenchidos pelo sistema, e não pelo usuário — hoje, só a data. */
  defaults: EntityName[];
}

export const REGISTRATION_FIELDS: readonly EntityName[] = [
  'type',
  'amount',
  'date',
  'category',
  'description',
];
export const REGISTRATION_REQUIRED: readonly EntityName[] = [
  'type',
  'amount',
  'category',
];

export interface MessageFacts {
  normalized: string;
  amounts: AmountMention[];
  dates: DateMention[];
  typeHint: TransactionType | null;
}

/** O que o texto diz, sem passar pelo modelo. */
export function readFacts(message: string, reference: string): MessageFacts {
  const normalized = normalize(message);
  const dates = extractDates(normalized, reference);
  return {
    normalized,
    dates,
    amounts: extractAmounts(mask(normalized, dates)),
    typeHint: detectTypeHint(normalized),
  };
}

const ORDINALS: Record<string, number> = {
  primeiro: 0,
  primeira: 0,
  segundo: 1,
  segunda: 1,
  terceiro: 2,
  terceira: 2,
  quarto: 3,
  quarta: 3,
};

/** "o segundo", "a última", "o maior": escolha entre as opções oferecidas. */
function pickOption(text: string, options: string[]): string | null {
  const match =
    /\b(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|ultim[oa]|maior|menor)\b/.exec(
      text,
    );
  if (!match || options.length === 0) return null;

  const word = match[1];
  if (word.startsWith('ultim')) return options[options.length - 1];
  if (word === 'maior' || word === 'menor') {
    if (options.some((option) => Number.isNaN(Number(option)))) return null;
    const sorted = [...options].sort((a, b) => Number(a) - Number(b));
    return word === 'maior' ? sorted[sorted.length - 1] : sorted[0];
  }
  return options[ORDINALS[word]] ?? null;
}

const distinct = <T>(items: T[]) => [...new Set(items)];

/** Categoria citada pelo nome na própria mensagem ("alimentação", "saude"). */
export function categoryInText(
  text: string,
  context: InterpretationContext,
  type: TransactionType | null,
): string | null {
  const names = distinct(
    context.categories
      .filter((item) => !type || item.type === type)
      .map((item) => item.name)
      .filter((name) => new RegExp(`\\b${comparable(name)}\\b`).test(text)),
  );
  return names.length === 1 ? names[0] : null;
}

interface FieldUpdate<T> {
  value: T | null;
  clarification: Clarification | null;
  /** A mensagem disse algo sobre o campo; sem isso, vale o estado anterior. */
  touched: boolean;
}

const untouched = <T>(): FieldUpdate<T> => ({
  value: null,
  clarification: null,
  touched: false,
});

/**
 * Valor: só o que está escrito na mensagem. O número sugerido pelo modelo não
 * é usado — ele pode ter vindo de outra parte da conversa ou ter sido
 * inventado. Havendo "R$", "reais" ou "centavos", só esses números contam;
 * "3 pães por 10 reais" é R$ 10. Mais de um valor é pergunta, nunca escolha:
 * "30 no uber e 50 no mercado" são dois lançamentos.
 */
function updateAmount(
  facts: MessageFacts,
  pending: Clarification | undefined,
): FieldUpdate<string> {
  if (pending?.reason === 'multiplos_valores') {
    const picked = pickOption(facts.normalized, pending.options);
    if (picked) return { value: picked, clarification: null, touched: true };
  }

  const marked = facts.amounts.filter((item) => item.marked);
  const pool = marked.length > 0 ? marked : facts.amounts;
  const values = distinct(pool.map((item) => item.cents));

  if (values.length === 0) return untouched();
  if (values.length === 1) {
    return {
      value: centsToAmount(values[0]),
      clarification: null,
      touched: true,
    };
  }
  return {
    value: null,
    clarification: {
      field: 'amount',
      reason: 'multiplos_valores',
      options: values.map(centsToAmount),
    },
    touched: true,
  };
}

function updateDate(
  facts: MessageFacts,
  pending: Clarification | undefined,
): FieldUpdate<string> {
  if (pending?.reason === 'multiplas_datas') {
    const picked = pickOption(facts.normalized, pending.options);
    if (picked) return { value: picked, clarification: null, touched: true };
  }

  if (facts.dates.length === 0) return untouched();

  const resolved = distinct(
    facts.dates
      .filter((item) => item.kind === 'resolvida')
      .map((item) => item.date as string),
  );
  const unclear = facts.dates.find((item) => item.kind !== 'resolvida');

  if (resolved.length > 1) {
    return {
      value: null,
      clarification: {
        field: 'date',
        reason: 'multiplas_datas',
        options: resolved,
      },
      touched: true,
    };
  }
  if (resolved.length === 1 && !unclear) {
    return { value: resolved[0], clarification: null, touched: true };
  }
  return {
    value: null,
    clarification: {
      field: 'date',
      reason:
        unclear?.kind === 'invalida' && resolved.length === 0
          ? 'data_invalida'
          : 'data_imprecisa',
      options: resolved,
    },
    touched: true,
  };
}

/**
 * Tipo: as palavras da mensagem conferem o modelo. Discordando, o sistema
 * pergunta. Numa resposta curta a "receita ou despesa?", vale a resposta.
 */
function updateType(
  facts: MessageFacts,
  modelType: unknown,
  askedForType: boolean,
): FieldUpdate<TransactionType> {
  const fromModel =
    modelType === 'receita' || modelType === 'despesa' ? modelType : null;
  const hint =
    facts.typeHint ?? (askedForType ? readTypeAnswer(facts.normalized) : null);

  if (hint && fromModel && hint !== fromModel) {
    return {
      value: null,
      clarification: { field: 'type', reason: 'tipo_conflitante', options: [] },
      touched: true,
    };
  }
  const value = hint ?? fromModel;
  return value ? { value, clarification: null, touched: true } : untouched();
}

/**
 * Atualiza o lançamento em preparo com uma mensagem do usuário. Serve à
 * primeira mensagem (`previous` nulo) e às respostas seguintes, que completam
 * ou corrigem o que já se sabia (TCC-025). `model` traz as entidades sugeridas
 * pelo LLM, ou `null` quando a resposta foi lida só pelo extrator.
 */
export function updateRegistration(
  previous: RegistrationState | null,
  message: string,
  model: Record<string, unknown> | null,
  context: InterpretationContext,
): RegistrationState {
  const facts = readFacts(message, context.referenceDate);
  const before = previous?.entities ?? emptyEntities();
  const pendingOf = (field: EntityName) =>
    previous?.clarifications.find((item) => item.field === field);

  const askedForType = previous
    ? before.type === null || pendingOf('type') !== undefined
    : false;

  const type = updateType(facts, model?.type, askedForType);
  const amount = updateAmount(facts, pendingOf('amount'));
  const date = updateDate(facts, pendingOf('date'));

  const finalType = type.touched ? type.value : before.type;

  const categoryName =
    (typeof model?.category === 'string' ? model.category : null) ??
    categoryInText(facts.normalized, context, finalType) ??
    before.category?.name ??
    null;

  const description =
    (typeof model?.description === 'string' ? model.description : null) ??
    before.description;

  const entities = sanitizeEntities(
    {
      type: finalType,
      amount: amount.touched ? amount.value : before.amount,
      date: date.touched ? date.value : before.date,
      category: categoryName,
      description,
    },
    REGISTRATION_FIELDS,
    context,
  );

  const clarifications: Clarification[] = [];
  const carry = (field: EntityName, update: FieldUpdate<unknown>) => {
    if (update.touched) {
      if (update.clarification) clarifications.push(update.clarification);
      return;
    }
    const old = pendingOf(field);
    if (old) clarifications.push(old);
  };
  carry('type', type);
  carry('amount', amount);
  carry('date', date);

  // A categoria sugerida pelo modelo não desempata um verbo que contradiz o
  // tipo ("recebi 50 no mercado"): o tipo fica em aberto até o usuário dizer.
  // A categoria é mantida e revalidada quando o tipo chegar.
  if (clarifications.some((item) => item.field === 'type')) {
    entities.type = null;
  }

  const defaults: EntityName[] = [];
  const dateClarified = clarifications.some((item) => item.field === 'date');
  if (entities.date === null && !dateClarified) {
    entities.date = context.referenceDate;
    defaults.push('date');
  } else if (!date.touched && previous?.defaults.includes('date')) {
    defaults.push('date');
  }

  return { entities, clarifications, defaults };
}

/** Obrigatórios ainda ausentes, sem contar os que já estão em esclarecimento. */
export function missingFields(state: RegistrationState): EntityName[] {
  return REGISTRATION_REQUIRED.filter(
    (field) =>
      state.entities[field] === null &&
      !state.clarifications.some((item) => item.field === field),
  );
}

export function isComplete(state: RegistrationState): boolean {
  return missingFields(state).length === 0 && state.clarifications.length === 0;
}
