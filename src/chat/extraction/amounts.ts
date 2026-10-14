import { readNumberWords } from './number-words';
import { tokenize, type Token } from './text';

export interface AmountMention {
  start: number;
  end: number;
  /** Centavos inteiros: valor financeiro nunca passa por ponto flutuante. */
  cents: number;
  /** Veio com "R$", "reais", "conto" ou "centavos": é dinheiro, não quantidade. */
  marked: boolean;
}

const CURRENCY_AFTER = new Set([
  'reais',
  'real',
  'conto',
  'contos',
  'pila',
  'pilas',
  'mangos',
]);
const CENTS_AFTER = new Set(['centavo', 'centavos']);

/** Números que não são dinheiro: "3x", "10%", "2 horas", "10h". */
const NOT_MONEY_AFTER = new Set([
  '%',
  'x',
  'vezes',
  'h',
  'hs',
  'hrs',
  'hora',
  'horas',
  'min',
  'minuto',
  'minutos',
  'km',
  'kg',
  'g',
  'ml',
  'l',
  'litro',
  'litros',
  'anos',
  'ano',
  'meses',
  'mes',
]);

/** Números que identificam algo, e não valor: "mês 10", "parcela 3", "nº 45". */
const NOT_MONEY_BEFORE = new Set([
  'mes',
  'parcela',
  'apartamento',
  'apto',
  'ap',
  'casa',
  'numero',
  'n',
  'no',
  'linha',
  'onibus',
  'as',
]);

/**
 * "1.234,56", "1234,56", "45", "45,5" no formato brasileiro; "120.50" com ponto
 * decimal quando há uma ou duas casas depois do ponto; "1.234" é milhar.
 */
function digitsToCents(text: string): number | null {
  let integer: string;
  let decimals = '';

  if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length !== 2) return null;
    integer = parts[0].replace(/\./g, '');
    decimals = parts[1];
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    integer = text.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(text)) {
    [integer, decimals] = text.split('.');
  } else if (/^\d+$/.test(text)) {
    integer = text;
  } else {
    return null;
  }

  if (!/^\d+$/.test(integer) || !/^\d{0,2}$/.test(decimals)) return null;
  return Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
}

function readNumber(
  tokens: readonly Token[],
  index: number,
): { cents: number; next: number; fromWords: boolean } | null {
  const token = tokens[index];
  if (/^\d/.test(token.text)) {
    const cents = digitsToCents(token.text);
    return cents === null ? null : { cents, next: index + 1, fromWords: false };
  }
  const words = readNumberWords(tokens, index);
  if (!words) return null;
  return { cents: words.value * 100, next: words.next, fromWords: true };
}

const adjacent = (a: Token, b: Token | undefined) => b?.start === a.end;

/**
 * Encontra os valores em dinheiro de um texto normalizado e já sem as datas
 * (mascaradas antes, para "dia 5" e "12/10" não virarem valor).
 */
export function extractAmounts(text: string): AmountMention[] {
  const tokens = tokenize(text);
  const mentions: AmountMention[] = [];
  let i = 0;

  while (i < tokens.length) {
    const prefixed = tokens[i].text === 'r$';
    const startIndex = prefixed ? i + 1 : i;
    if (startIndex >= tokens.length) break;

    const number = readNumber(tokens, startIndex);
    if (!number) {
      i++;
      continue;
    }

    const first = tokens[startIndex];
    let cents = number.cents;
    let j = number.next;
    let marked = prefixed;

    const multiplier = tokens[j]?.text;
    if (multiplier === 'mil' && !number.fromWords) {
      cents *= 1000;
      j++;
    } else if (multiplier === 'k' && adjacent(tokens[j - 1], tokens[j])) {
      cents *= 1000;
      j++;
    }

    const after = tokens[j]?.text;
    const before = tokens[startIndex - 1]?.text;
    if (
      !prefixed &&
      ((after !== undefined && NOT_MONEY_AFTER.has(after)) ||
        (before !== undefined && NOT_MONEY_BEFORE.has(before)))
    ) {
      i = j;
      continue;
    }

    if (after && CENTS_AFTER.has(after)) {
      marked = true;
      cents = Math.round(cents / 100);
      j++;
    } else if (after && CURRENCY_AFTER.has(after)) {
      marked = true;
      j++;
      // "45 reais e 50 centavos"
      if (tokens[j]?.text === 'e' && tokens[j + 1]) {
        const extra = readNumber(tokens, j + 1);
        if (extra && CENTS_AFTER.has(tokens[extra.next]?.text ?? '')) {
          cents += Math.round(extra.cents / 100);
          j = extra.next + 1;
        }
      }
    }

    // "um" e "uma" sozinhos são artigo ("um negócio de 30"), não valor.
    const loneArticle =
      number.fromWords &&
      number.next - startIndex === 1 &&
      (first.text === 'um' || first.text === 'uma') &&
      !marked &&
      cents === 100;

    if (!loneArticle) {
      mentions.push({
        start: tokens[i].start,
        end: tokens[j - 1].end,
        cents,
        marked,
      });
    }
    i = j;
  }

  return mentions;
}

export function centsToAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
