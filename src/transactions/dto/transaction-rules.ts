/**
 * Regras de valor e de data do lançamento, em funções puras.
 *
 * Cada função devolve a mensagem de erro, ou `null` quando o valor serve. As
 * mensagens repetem as do formulário do frontend: as duas interfaces do
 * estudo precisam reprovar a mesma entrada com o mesmo texto.
 */

/** numeric(12,2): dez dígitos inteiros e duas casas. */
const MAX_AMOUNT = 9_999_999_999.99;

export const AMOUNT_MESSAGES = {
  required: 'Informe o valor.',
  positive: 'O valor deve ser maior que zero.',
  decimals: 'Use no máximo duas casas decimais.',
  max: 'O valor deve ser no máximo 9.999.999.999,99.',
} as const;

export const DATE_MESSAGES = {
  required: 'Informe a data.',
  invalid: 'Informe uma data válida.',
} as const;

/**
 * O valor chega como texto decimal ("35.90"), nunca como número JSON:
 * ponto flutuante não representa 0,1 exatamente e o erro apareceria como um
 * centavo de diferença nos totais.
 */
export function checkAmount(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return AMOUNT_MESSAGES.required;
  }

  if (!/^-?\d+(\.\d+)?$/.test(value)) return AMOUNT_MESSAGES.required;

  const [integer, decimals = ''] = value.replace('-', '').split('.');
  const isZero = /^0*$/.test(integer + decimals);

  if (value.startsWith('-') || isZero) return AMOUNT_MESSAGES.positive;
  if (decimals.length > 2) return AMOUNT_MESSAGES.decimals;
  if (Number(value) > MAX_AMOUNT) return AMOUNT_MESSAGES.max;

  return null;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/**
 * Data civil `AAAA-MM-DD` que existe no calendário. `new Date('2026-02-30')`
 * é rejeitada pelo round-trip abaixo, e não por `isNaN`, porque o motor de
 * JavaScript aceita alguns dias inexistentes ao interpretar texto.
 */
export function checkCivilDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return DATE_MESSAGES.required;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return DATE_MESSAGES.invalid;

  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  if (year < MIN_YEAR || year > MAX_YEAR) return DATE_MESSAGES.invalid;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const exists =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return exists ? null : DATE_MESSAGES.invalid;
}

/** Instante `00:00:00Z` da data civil: a coluna é `date`, sem hora nem fuso. */
export function civilDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Inverso: nunca passa por fuso local, ou a data andaria um dia. */
export function utcToCivilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
