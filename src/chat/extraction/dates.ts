import { readNumberWords } from './number-words';
import { mask, tokenize } from './text';

export type DateMentionKind = 'resolvida' | 'vaga' | 'invalida';

export interface DateMention {
  start: number;
  end: number;
  kind: DateMentionKind;
  /** `AAAA-MM-DD` quando `kind` é `resolvida`. */
  date: string | null;
}

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
const MONTH = `(${Object.keys(MONTHS).join('|')})`;

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

/**
 * Expressões que falam de quando, mas sem dia. Para registrar um lançamento o
 * sistema pergunta o dia em vez de assumir hoje — assumir seria gravar uma
 * data que o usuário não disse.
 */
const VAGUE =
  /\b(semana passada|semana retrasada|outro dia|esses dias|estes dias|uns dias atras|alguns dias atras|dias atras|fim de semana|final de semana|recentemente|mes passado|ano passado)\b/g;

/** "segunda via", "quinta parcela": o dia da semana usado como ordinal. */
const ORDINAL_USE =
  /^\s+(via|parcela|prestacao|vez|parte|mao|chamada|opcao|feira livre)\b/;

/** Expressão que fala de quando sem dizer o dia ("há poucos dias"). */
const VAGA = Symbol('vaga');

type Resolution = string | null | typeof VAGA;

function parseIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function build(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function addDays(reference: string, days: number): string {
  const { year, month, day } = parseIso(reference);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function weekdayOf(reference: string): number {
  const { year, month, day } = parseIso(reference);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Sem ano, vale a ocorrência mais recente que não passa de hoje: quem registra
 * um gasto fala de algo que já aconteceu. "25/12" dito em janeiro é o Natal
 * anterior.
 */
function withoutYear(reference: string, month: number, day: number) {
  const today = parseIso(reference);
  const thisYear = build(today.year, month, day);
  if (thisYear === null) return build(today.year - 1, month, day);
  return thisYear > reference ? build(today.year - 1, month, day) : thisYear;
}

/** "dia 20" dito no dia 13 é o dia 20 do mês anterior, pelo mesmo motivo. */
function dayOnly(reference: string, day: number) {
  const today = parseIso(reference);
  const thisMonth = build(today.year, today.month, day);
  if (thisMonth !== null && thisMonth <= reference) return thisMonth;

  const previous = today.month === 1 ? 12 : today.month - 1;
  const year = today.month === 1 ? today.year - 1 : today.year;
  return build(year, previous, day);
}

function smallNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  const read = readNumberWords(tokenize(text), 0);
  return read?.value ?? null;
}

function relativeBack(
  amount: string,
  unit: string,
  reference: string,
): Resolution {
  const count = smallNumber(amount);
  if (count === null) return VAGA;
  if (count <= 0 || count > 366) return null;
  return addDays(reference, -(unit.startsWith('semana') ? count * 7 : count));
}

const dayNumber = (text: string) => (text === 'primeiro' ? 1 : Number(text));

const NUMBER = '(\\d{1,3}|[a-z]+(?:\\s+e\\s+[a-z]+)?)';

interface Rule {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray, reference: string) => Resolution;
  accept?: (match: RegExpMatchArray, text: string) => boolean;
}

const RULES: Rule[] = [
  {
    pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    resolve: (m) => build(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    pattern: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g,
    resolve: (m, reference) => {
      if (!m[3]) return withoutYear(reference, Number(m[2]), Number(m[1]));
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return build(year, Number(m[2]), Number(m[1]));
    },
  },
  {
    pattern: new RegExp(
      `\\b(?:dia\\s+)?(primeiro|\\d{1,2})[oº°]?\\s+de\\s+${MONTH}(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`,
      'g',
    ),
    resolve: (m, reference) =>
      m[3]
        ? build(Number(m[3]), MONTHS[m[2]], dayNumber(m[1]))
        : withoutYear(reference, MONTHS[m[2]], dayNumber(m[1])),
  },
  {
    pattern: /\bdia\s+(primeiro|\d{1,2})\b/g,
    resolve: (m, reference) => dayOnly(reference, dayNumber(m[1])),
  },
  {
    pattern:
      /\b(depois de amanha|antes de ontem|anteontem|ontem|hoje|amanha)\b/g,
    resolve: (m, reference) => {
      const offsets: Record<string, number> = {
        'depois de amanha': 2,
        amanha: 1,
        hoje: 0,
        ontem: -1,
        anteontem: -2,
        'antes de ontem': -2,
      };
      return addDays(reference, offsets[m[1]]);
    },
  },
  {
    pattern: new RegExp(`\\bha\\s+${NUMBER}\\s+(dias?|semanas?)\\b`, 'g'),
    resolve: (m, reference) => relativeBack(m[1], m[2], reference),
  },
  {
    pattern: new RegExp(`\\b${NUMBER}\\s+(dias?|semanas?)\\s+atras\\b`, 'g'),
    resolve: (m, reference) => relativeBack(m[1], m[2], reference),
  },
  {
    pattern:
      /\b(?:(na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|ultima|ultimo|proxima|proximo|desta|dessa|deste|desse)\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)([\s-]feira)?(?:\s+(passada|passado|retrasada|retrasado|que vem|que passou))?\b/g,
    // Sem "feira", sem artigo e sem "passada", o dia da semana pode ser só
    // um ordinal; domingo e sábado não têm esse outro sentido.
    accept: (m, text) => {
      const after = text.slice((m.index ?? 0) + m[0].length);
      if (!m[3] && !m[4] && ORDINAL_USE.test(after)) return false;
      return (
        m[2] === 'domingo' || m[2] === 'sabado' || Boolean(m[1] || m[3] || m[4])
      );
    },
    resolve: (m, reference) => {
      const target = WEEKDAYS[m[2]];
      const today = weekdayOf(reference);
      const qualifier = `${m[1] ?? ''} ${m[4] ?? ''}`;
      if (/proxim|que vem/.test(qualifier)) {
        return addDays(reference, (target - today + 7) % 7 || 7);
      }
      const back = (today - target + 7) % 7 || 7;
      const extra = /retrasad/.test(qualifier) ? 7 : 0;
      return addDays(reference, -(back + extra));
    },
  },
];

/**
 * Encontra as menções de data em um texto já normalizado (`normalize`). Cada
 * padrão mascara o que encontrou, para "dia 5 de outubro" não ser lido também
 * como "dia 5".
 */
export function extractDates(text: string, reference: string): DateMention[] {
  const mentions: DateMention[] = [];
  let remaining = text;

  for (const rule of RULES) {
    for (const match of remaining.matchAll(rule.pattern)) {
      if (rule.accept && !rule.accept(match, remaining)) continue;
      const resolution = rule.resolve(match, reference);
      mentions.push({
        start: match.index,
        end: match.index + match[0].length,
        kind:
          resolution === VAGA
            ? 'vaga'
            : resolution === null
              ? 'invalida'
              : 'resolvida',
        date: resolution === VAGA ? null : resolution,
      });
    }
    remaining = mask(remaining, mentions);
  }

  for (const match of remaining.matchAll(VAGUE)) {
    mentions.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: 'vaga',
      date: null,
    });
  }

  return mentions.sort((a, b) => a.start - b.start);
}
