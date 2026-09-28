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

/**
 * Meses que o período toca, cada um recortado pelas pontas do período: de
 * 15/08 a 10/10 vira agosto (15 a 31), setembro inteiro e outubro (1 a 10).
 */
export function monthsInPeriod(period: {
  from: string;
  to: string;
}): { month: string; from: string; to: string }[] {
  const months: { month: string; from: string; to: string }[] = [];
  let month = period.from.slice(0, 7);
  const last = period.to.slice(0, 7);

  while (month <= last) {
    const bounds = monthToPeriod(month);
    months.push({
      month,
      from: bounds.from < period.from ? period.from : bounds.from,
      to: bounds.to > period.to ? period.to : bounds.to,
    });

    const [year, monthNumber] = month.split('-').map(Number);
    month =
      monthNumber === 12
        ? `${year + 1}-01`
        : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  }

  return months;
}

/** Quantos meses de calendário o período toca, contando os das pontas. */
export function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);

  return (ty - fy) * 12 + (tm - fm) + 1;
}
