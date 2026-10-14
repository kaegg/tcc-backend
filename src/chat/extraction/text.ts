/**
 * Minúsculas e sem acento, com o mesmo comprimento do original: as posições
 * encontradas no texto normalizado continuam valendo para mascarar trechos.
 */
export function normalize(text: string): string {
  let out = '';
  for (const unit of text.split('')) {
    const base = unit.normalize('NFD').replace(/\p{M}/gu, '');
    out += base.length === 1 ? base : unit;
  }
  return out.toLowerCase();
}

/** Troca os trechos por espaços, para que não sejam lidos de novo. */
export function mask(
  text: string,
  spans: readonly { start: number; end: number }[],
): string {
  let out = text;
  for (const { start, end } of spans) {
    out = out.slice(0, start) + ' '.repeat(end - start) + out.slice(end);
  }
  return out;
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  return [...text.matchAll(/r\$|\d+(?:[.,]\d+)*|[a-z]+|%/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
