/**
 * Mês de referência `AAAA-MM`, na faixa de datas que o banco aceita
 * (`transactions_date_in_range`: 2000-01-01 a 2100-01-01).
 */

export const MONTH_MESSAGES = {
  required: 'Informe o mês.',
  invalid: 'Informe um mês válido.',
} as const;

const MIN_MONTH = '2000-01';
const MAX_MONTH = '2100-01';

export function checkMonth(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return MONTH_MESSAGES.required;
  }

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return MONTH_MESSAGES.invalid;
  if (value < MIN_MONTH || value > MAX_MONTH) return MONTH_MESSAGES.invalid;

  return null;
}

/** Primeiro e último dia do mês, como datas civis. Dia 0 do mês seguinte é o último deste. */
export function monthToPeriod(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}
