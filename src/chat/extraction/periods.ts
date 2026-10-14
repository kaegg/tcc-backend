import {
  addDays,
  build,
  extractDates,
  MONTH,
  MONTHS,
  smallNumber,
} from './dates';
import { mask } from './text';

/** Datas civis `AAAA-MM-DD`, as duas inclusivas, como no relatório. */
export interface Period {
  from: string;
  to: string;
}

export type PeriodReading =
  | { kind: 'resolvido'; period: Period }
  | { kind: 'ausente' }
  | { kind: 'impreciso' }
  | { kind: 'invalido' }
  | { kind: 'multiplos'; options: Period[] };

interface Anchor {
  start: number;
  end: number;
  /** `null` quando a expressão aponta para uma data que não existe. */
  period: Period | null;
}

/**
 * Fala de quando sem dizer o período: o sistema pergunta em vez de escolher um.
 * Somar o mês inteiro para "no começo do mês" seria responder outra pergunta.
 */
const VAGUE =
  /\b(recentemente|ultimamente|esses dias|estes dias|nesses dias|desses dias|destes dias|outro dia|ha pouco tempo|ultimos dias|ultimas semanas|ultimos meses|ultimos anos|(?:comeco|inicio|fim|final|meio)\s+d[aeo]s?|fim de semana|final de semana)\b/;

function parse(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

/** Aceita estouro (dia 0, mês 13): `Date.UTC` normaliza. */
function civil(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function monthSpan(year: number, month: number): Period {
  return { from: civil(year, month, 1), to: civil(year, month + 1, 0) };
}

const yearSpan = (year: number): Period => ({
  from: civil(year, 1, 1),
  to: civil(year, 12, 31),
});

/** Semana de segunda a domingo, como no calendário brasileiro de trabalho. */
function weekSpan(reference: string, weeksBack: number): Period {
  const { year, month, day } = parse(reference);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monday = addDays(reference, -((weekday + 6) % 7) - 7 * weeksBack);
  return { from: monday, to: addDays(monday, 6) };
}

function monthsBack(reference: string, back: number): Period {
  const { year, month } = parse(reference);
  return monthSpan(year, month - back);
}

/**
 * Mês sem ano: o mais recente que já começou. "Dezembro" dito em março é o
 * dezembro anterior — quem consulta fala do que já aconteceu, como no registro.
 */
function recentMonth(reference: string, month: number): Period {
  const today = parse(reference);
  return monthSpan(month > today.month ? today.year - 1 : today.year, month);
}

function day(date: string | null): Period | null {
  return date ? { from: date, to: date } : null;
}

function dayRange(from: string | null, to: string | null): Period | null {
  return from && to ? { from, to } : null;
}

interface Rule {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray, reference: string) => Period | null;
}

const DAY = '(\\d{1,2})';
const YEAR = '(?:\\s+(?:de\\s+)?(\\d{4}))?';

/** Antes das datas soltas: "de 1 a 15 de setembro" não são duas datas. */
const RANGE_RULES: Rule[] = [
  {
    pattern: new RegExp(
      `\\b(?:(?:de|do dia|dos dias|entre(?:\\s+os\\s+dias|\\s+o\\s+dia)?)\\s+)?${DAY}\\s+(?:a|ao|ate|e)\\s+(?:o\\s+)?(?:dia\\s+)?${DAY}\\s+de\\s+${MONTH}${YEAR}\\b`,
      'g',
    ),
    resolve: (m, reference) => {
      const month = MONTHS[m[3]];
      const year = m[4]
        ? Number(m[4])
        : parse(recentMonth(reference, month).from).year;
      return dayRange(
        build(year, month, Number(m[1])),
        build(year, month, Number(m[2])),
      );
    },
  },
  {
    // Sem mês, os dois dias são do mês corrente: "do dia 1 ao dia 20".
    pattern: new RegExp(
      `\\b(?:do\\s+)?dia\\s+${DAY}\\s+(?:a|ao|ate)\\s+(?:o\\s+)?(?:dia\\s+)?${DAY}\\b`,
      'g',
    ),
    resolve: (m, reference) => {
      const { year, month } = parse(reference);
      return dayRange(
        build(year, month, Number(m[1])),
        build(year, month, Number(m[2])),
      );
    },
  },
];

const THIS = '(?:n?este|n?esse|n?esta|n?essa|deste|desse|desta|dessa)';

const RELATIVE_RULES: Rule[] = [
  {
    pattern: new RegExp(`\\b(?:${THIS}\\s+semana|semana atual)\\b`, 'g'),
    resolve: (_, reference) => weekSpan(reference, 0),
  },
  {
    pattern: /\b(?:semana passada|semana anterior|ultima semana)\b/g,
    resolve: (_, reference) => weekSpan(reference, 1),
  },
  {
    pattern: /\bsemana retrasada\b/g,
    resolve: (_, reference) => weekSpan(reference, 2),
  },
  {
    pattern: new RegExp(
      `\\b(?:${THIS}\\s+mes|mes atual|mes corrente|do mes(?!\\s+(?:de|passado|anterior|retrasado)\\b))\\b`,
      'g',
    ),
    resolve: (_, reference) => monthsBack(reference, 0),
  },
  {
    pattern: /\b(?:mes passado|mes anterior|ultimo mes)\b/g,
    resolve: (_, reference) => monthsBack(reference, 1),
  },
  {
    pattern: /\bmes retrasado\b/g,
    resolve: (_, reference) => monthsBack(reference, 2),
  },
  {
    pattern: new RegExp(`\\b(?:${THIS}\\s+ano|ano atual|ano corrente)\\b`, 'g'),
    resolve: (_, reference) => yearSpan(parse(reference).year),
  },
  {
    pattern: /\b(?:ano passado|ano anterior|ultimo ano)\b/g,
    resolve: (_, reference) => yearSpan(parse(reference).year - 1),
  },
  {
    // "Últimos 3 meses" segue o predefinido da tela de relatórios: do dia 1
    // de dois meses atrás até o fim do mês atual. Dias e semanas terminam hoje.
    pattern:
      /\b(?:n?[ao]s\s+)?ultim[oa]s\s+(\d{1,3}|[a-z]+(?:\s+e\s+[a-z]+)?)\s+(dias|semanas|meses)\b/g,
    resolve: (m, reference) => {
      const count = smallNumber(m[1]);
      if (count === null || count < 1 || count > 366) return null;
      if (m[2] === 'meses') {
        const { year, month } = parse(reference);
        return {
          from: civil(year, month - (count - 1), 1),
          to: civil(year, month + 1, 0),
        };
      }
      const days = m[2] === 'semanas' ? count * 7 : count;
      return { from: addDays(reference, -(days - 1)), to: reference };
    },
  },
];

/** Depois das datas soltas: em "5 de outubro", outubro não é o mês inteiro. */
const CALENDAR_RULES: Rule[] = [
  {
    pattern: new RegExp(
      `\\b${MONTH}(?:\\s+(?:de\\s+|do\\s+ano\\s+(?:de\\s+)?)?(\\d{4}))?\\b`,
      'g',
    ),
    resolve: (m, reference) =>
      m[2]
        ? monthSpan(Number(m[2]), MONTHS[m[1]])
        : recentMonth(reference, MONTHS[m[1]]),
  },
  {
    // O ano precisa de preposição e não pode ser valor: "de 2000 reais".
    pattern:
      /\b(?:em|de|do ano de|no ano de|ano de|durante)\s+((?:19|20)\d{2})\b(?!\s*(?:reais|real|conto|mil|r\$|,\d|\.\d))/g,
    resolve: (m) => yearSpan(Number(m[1])),
  },
];

function apply(
  rules: Rule[],
  text: string,
  reference: string,
  anchors: Anchor[],
): string {
  let remaining = text;
  for (const rule of rules) {
    for (const match of remaining.matchAll(rule.pattern)) {
      anchors.push({
        start: match.index,
        end: match.index + match[0].length,
        period: rule.resolve(match, reference),
      });
    }
    remaining = mask(remaining, anchors);
  }
  return remaining;
}

const RANGE_GAP = /^\s*(?:a|ao|ate)\s+(?:o\s+|a\s+)?(?:dia\s+)?$/;
const BETWEEN_GAP = /^\s*e\s+(?:o\s+)?(?:dia\s+)?$/;
const BETWEEN_BEFORE =
  /\bentre\s+(?:os\s+dias\s+|o\s+dia\s+|os\s+meses\s+de\s+)?$/;
const SINCE_BEFORE =
  /\b(?:desde|a partir d[eoa])\s+(?:o\s+|a\s+)?(?:dia\s+)?(?:mes\s+de\s+)?$/;

const same = (a: Period, b: Period) => a.from === b.from && a.to === b.to;

/**
 * Período de uma consulta, lido do texto normalizado (`normalize`) contra a
 * data de referência. O modelo não participa: um modelo de 7B em CPU erra a
 * conta de "mês passado", e o total errado seria dito com toda a segurança.
 */
export function extractPeriod(text: string, reference: string): PeriodReading {
  const anchors: Anchor[] = [];
  let remaining = apply(RANGE_RULES, text, reference, anchors);
  remaining = apply(RELATIVE_RULES, remaining, reference, anchors);

  const vague = VAGUE.test(text);
  const dates = extractDates(remaining, reference);
  if (dates.some((item) => item.kind === 'vaga')) {
    return { kind: 'impreciso' };
  }
  for (const item of dates) {
    anchors.push({ start: item.start, end: item.end, period: day(item.date) });
  }
  remaining = mask(remaining, anchors);
  apply(CALENDAR_RULES, remaining, reference, anchors);

  anchors.sort((a, b) => a.start - b.start);

  if (anchors.some((anchor) => anchor.period === null)) {
    return { kind: 'invalido' };
  }
  if (vague) return { kind: 'impreciso' };
  if (anchors.length === 0) return { kind: 'ausente' };

  const periods = anchors.map((anchor) => anchor.period as Period);

  if (anchors.length === 1) {
    const [only] = periods;
    if (SINCE_BEFORE.test(text.slice(0, anchors[0].start))) {
      return { kind: 'resolvido', period: { from: only.from, to: reference } };
    }
    return { kind: 'resolvido', period: only };
  }

  if (anchors.length === 2) {
    const [first, second] = anchors;
    const gap = text.slice(first.end, second.start);
    const before = text.slice(0, first.start);
    if (
      RANGE_GAP.test(gap) ||
      (BETWEEN_GAP.test(gap) && BETWEEN_BEFORE.test(before))
    ) {
      return {
        kind: 'resolvido',
        period: { from: periods[0].from, to: periods[1].to },
      };
    }
  }

  const options = periods.filter(
    (period, index) =>
      periods.findIndex((item) => same(item, period)) === index,
  );
  return options.length === 1
    ? { kind: 'resolvido', period: options[0] }
    : { kind: 'multiplos', options };
}
