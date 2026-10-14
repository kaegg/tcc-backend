import { NO_CONTROL_CHARS } from '../../transactions/dto/create-transaction.dto';
import {
  checkAmount,
  checkCivilDate,
} from '../../transactions/dto/transaction-rules';
import type { TransactionType } from '../../generated/prisma/enums';

export interface CategoryOption {
  id: string;
  name: string;
  type: TransactionType;
}

export interface InterpretationContext {
  /** Hoje, `AAAA-MM-DD`, no fuso do estudo. */
  referenceDate: string;
  referenceWeekday: string;
  categories: CategoryOption[];
}

export interface Entities {
  type: TransactionType | null;
  /** Texto decimal com duas casas, o mesmo formato que a API REST recebe. */
  amount: string | null;
  date: string | null;
  category: { id: string; name: string } | null;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export type EntityName = keyof Entities;

const DESCRIPTION_MIN = 3;
const DESCRIPTION_MAX = 140;

interface EntityField {
  prompt: string;
  schema: (context: InterpretationContext) => Record<string, unknown>;
}

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
});

/**
 * Campos que o modelo pode extrair. A ordem é a do JSON gerado. Um campo novo
 * é uma entrada aqui, um tipo em `Entities` e uma regra em `sanitizeEntities`.
 */
export const ENTITY_FIELDS: Record<EntityName, EntityField> = {
  type: {
    prompt: '"receita" ou "despesa"',
    schema: () => nullable({ type: 'string', enum: ['receita', 'despesa'] }),
  },
  amount: {
    prompt: 'valor em reais, número com ponto decimal (ex.: 120.5)',
    schema: () => nullable({ type: 'number' }),
  },
  date: {
    prompt: 'data do fato, AAAA-MM-DD',
    schema: () => nullable({ type: 'string', format: 'date' }),
  },
  category: {
    prompt: 'uma das categorias listadas abaixo, escrita exatamente igual',
    schema: (context) =>
      nullable({
        type: 'string',
        enum: [...new Set(context.categories.map((item) => item.name))],
      }),
  },
  description: {
    prompt: `resumo curto do lançamento, até ${DESCRIPTION_MAX} caracteres`,
    schema: () => nullable({ type: 'string', maxLength: DESCRIPTION_MAX }),
  },
  periodStart: {
    prompt: 'início do período consultado, AAAA-MM-DD',
    schema: () => nullable({ type: 'string', format: 'date' }),
  },
  periodEnd: {
    prompt: 'fim do período consultado, AAAA-MM-DD',
    schema: () => nullable({ type: 'string', format: 'date' }),
  },
};

export const ENTITY_NAMES = Object.keys(ENTITY_FIELDS) as EntityName[];

export function emptyEntities(): Entities {
  return {
    type: null,
    amount: null,
    date: null,
    category: null,
    description: null,
    periodStart: null,
    periodEnd: null,
  };
}

/**
 * Valida cada campo com as mesmas regras do formulário (RNF12). Campo inválido
 * vira `null` — e com isso "ausente" —, em vez de derrubar a interpretação
 * inteira: o chatbot pergunta de novo em vez de falhar.
 */
export function sanitizeEntities(
  raw: Record<string, unknown>,
  allowed: readonly EntityName[],
  context: InterpretationContext,
): Entities {
  const entities = emptyEntities();
  const accepts = (name: EntityName) => allowed.includes(name);

  if (accepts('type') && (raw.type === 'receita' || raw.type === 'despesa')) {
    entities.type = raw.type;
  }
  if (accepts('amount')) entities.amount = sanitizeAmount(raw.amount);
  if (accepts('date')) entities.date = sanitizeDate(raw.date);
  if (accepts('description')) {
    entities.description = sanitizeDescription(raw.description);
  }
  if (accepts('periodStart') && accepts('periodEnd')) {
    const start = sanitizeDate(raw.periodStart);
    const end = sanitizeDate(raw.periodEnd);
    if (start && end && start <= end) {
      entities.periodStart = start;
      entities.periodEnd = end;
    }
  }
  if (accepts('category')) resolveCategory(entities, raw.category, context);

  return entities;
}

function sanitizeAmount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text = String(value);
  if (checkAmount(text) !== null) return null;
  return value.toFixed(2);
}

function sanitizeDate(value: unknown): string | null {
  return checkCivilDate(value) === null ? (value as string) : null;
}

function sanitizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, DESCRIPTION_MAX).trim();
  if (text.length < DESCRIPTION_MIN || !NO_CONTROL_CHARS.test(text)) {
    return null;
  }
  return text;
}

const comparable = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Há nomes repetidos entre os tipos ("Outros", "Investimentos"); sem o tipo, o
 * nome só serve se pertencer a um único tipo, e então o tipo é inferido dele.
 * Categoria de tipo diferente do informado é descartada.
 */
function resolveCategory(
  entities: Entities,
  value: unknown,
  context: InterpretationContext,
): void {
  if (typeof value !== 'string') return;

  const matches = context.categories.filter(
    (item) => comparable(item.name) === comparable(value),
  );
  const match = entities.type
    ? matches.find((item) => item.type === entities.type)
    : matches.length === 1
      ? matches[0]
      : undefined;

  if (!match) return;
  entities.category = { id: match.id, name: match.name };
  entities.type ??= match.type;
}
