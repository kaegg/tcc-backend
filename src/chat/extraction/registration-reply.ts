import type {
  EntityName,
  InterpretationContext,
} from '../interpretation/entities';
import { addDays } from './dates';
import {
  missingFields,
  type Clarification,
  type RegistrationState,
} from './registration';

/** O Intl separa "R$" do número com espaço não separável. */
const NBSP = String.fromCharCode(0xa0);

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatAmount(amount: string): string {
  return currency.format(Number(amount)).replaceAll(NBSP, ' ');
}

export function formatDate(date: string, reference: string): string {
  const [year, month, day] = date.split('-');
  const civil = `${day}/${month}/${year}`;
  if (date === reference) return `hoje (${civil})`;
  if (date === addDays(reference, -1)) return `ontem (${civil})`;
  return civil;
}

const FIELD_LABEL: Record<EntityName, string> = {
  type: 'se foi receita ou despesa',
  amount: 'o valor',
  category: 'a categoria',
  date: 'a data',
  description: 'a descrição',
  periodStart: 'o início do período',
  periodEnd: 'o fim do período',
};

export const FIELD_NAME: Record<EntityName, string> = {
  type: 'tipo',
  amount: 'valor',
  category: 'categoria',
  date: 'data',
  description: 'descrição',
  periodStart: 'início do período',
  periodEnd: 'fim do período',
};

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** "despesa de R$ 45,00 em Alimentação, ontem (12/10/2026), descrição “Mercado”" */
function summary(state: RegistrationState, reference: string): string {
  const { type, amount, category, date, description } = state.entities;

  const head = [
    type,
    amount ? `${type ? 'de ' : ''}${formatAmount(amount)}` : null,
    category ? `em ${category.name}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  let when: string | null = null;
  if (date && !state.clarifications.some((item) => item.field === 'date')) {
    const formatted = formatDate(date, reference);
    if (state.defaults.includes('date')) when = `com data de ${formatted}`;
    else if (/^(hoje|ontem)/.test(formatted)) when = formatted;
    else when = `em ${formatted}`;
  }

  return [head, when, description ? `descrição “${description}”` : null]
    .filter(Boolean)
    .join(', ');
}

function clarificationQuestion(item: Clarification, reference: string): string {
  switch (item.reason) {
    case 'multiplos_valores':
      return `Encontrei mais de um valor (${joinPt(item.options.map(formatAmount))}). Qual deles é o deste lançamento? Para registrar vários, envie um por vez.`;
    case 'multiplas_datas':
      return `A mensagem cita mais de uma data (${joinPt(item.options.map((date) => formatDate(date, reference)))}). Qual é a do lançamento?`;
    case 'data_imprecisa':
      return 'Em que dia foi? Pode responder, por exemplo, “ontem”, “sexta passada” ou “dia 5”.';
    case 'data_invalida':
      return 'Essa data não existe no calendário. Em que dia foi?';
    case 'tipo_conflitante':
      return 'Fiquei em dúvida: foi uma receita (dinheiro que entrou) ou uma despesa (dinheiro que saiu)?';
  }
}

function missingQuestion(
  missing: EntityName[],
  state: RegistrationState,
  context: InterpretationContext,
): string | null {
  if (missing.length === 0) return null;

  if (missing.length === 1) {
    const [field] = missing;
    if (field === 'amount') return 'Qual foi o valor?';
    if (field === 'type') return 'Foi uma receita ou uma despesa?';
    if (field === 'category') {
      const type = state.entities.type;
      const options = context.categories
        .filter((item) => item.type === type)
        .map((item) => item.name);
      return type && options.length > 0
        ? `Em qual categoria? Opções de ${type}: ${joinPt(options)}.`
        : 'Em qual categoria?';
    }
  }
  return `Para registrar, preciso saber ${joinPt(missing.map((field) => FIELD_LABEL[field]))}.`;
}

/** Dicas depois de tentativas sem sucesso no mesmo campo. */
function retryHint(field: EntityName, attempts: number): string | null {
  if (attempts < 2) return null;
  const example: Partial<Record<EntityName, string>> = {
    amount: 'escreva só o número, como “45,90”',
    date: 'responda com “hoje”, “ontem” ou uma data como “12/10”',
    category: 'escreva o nome de uma das categorias',
    type: 'responda “receita” ou “despesa”',
  };
  const tip = example[field] ?? 'responda só esse dado';
  return attempts >= 4
    ? `Se preferir, ${tip}, use o formulário em Lançamentos ou diga “cancelar”.`
    : `Dica: ${tip}. Para desistir, diga “cancelar”.`;
}

/**
 * Resposta do assistente para um lançamento em preparo, escrita pelo backend a
 * partir do estado validado — nunca pelo modelo. O texto do modelo poderia
 * afirmar um valor ou uma data que a validação corrigiu ou descartou.
 */
export function composeRegistrationReply(
  state: RegistrationState,
  context: InterpretationContext,
  attempts: Partial<Record<EntityName, number>> = {},
): string {
  const known = summary(state, context.referenceDate);
  const missing = missingFields(state);
  const questions = [
    ...state.clarifications.map((item) =>
      clarificationQuestion(item, context.referenceDate),
    ),
    missingQuestion(missing, state, context),
  ].filter((text): text is string => Boolean(text));

  if (questions.length === 0) {
    return `Entendi: ${known}. Confira os dados antes de registrar.`;
  }

  const pending = [
    ...state.clarifications.map((item) => item.field),
    ...missing,
  ];
  const hint = pending
    .map((field) => retryHint(field, attempts[field] ?? 0))
    .find(Boolean);

  return [known ? `Entendi até aqui: ${known}.` : null, ...questions, hint]
    .filter(Boolean)
    .join(' ');
}
