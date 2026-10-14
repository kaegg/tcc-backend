import type { Token } from './text';

const SMALL: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};

const MULTIPLIERS: Record<string, number> = {
  mil: 1_000,
  milhao: 1_000_000,
  milhoes: 1_000_000,
};

export const isNumberWord = (word: string) =>
  word in SMALL || word in MULTIPLIERS;

/**
 * Lê um número por extenso a partir de `tokens[index]` ("dois mil e
 * quinhentos"). Devolve o valor inteiro, o índice seguinte e quantas palavras
 * numéricas foram lidas, ou `null` se não começa ali um número.
 */
export function readNumberWords(
  tokens: readonly Token[],
  index: number,
): { value: number; next: number; words: number } | null {
  let total = 0;
  let current = 0;
  let words = 0;
  let i = index;

  while (i < tokens.length) {
    const word = tokens[i].text;

    if (word === 'e' && words > 0 && isNumberWord(tokens[i + 1]?.text ?? '')) {
      i++;
      continue;
    }
    if (word in SMALL) {
      current += SMALL[word];
    } else if (word in MULTIPLIERS) {
      total += (current || 1) * MULTIPLIERS[word];
      current = 0;
    } else {
      break;
    }
    words++;
    i++;
  }

  return words === 0 ? null : { value: total + current, next: i, words };
}
