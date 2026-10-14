const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  n: '\n',
  t: '\t',
  r: '',
  b: '',
  f: '',
};

/**
 * Extrai, enquanto o JSON chega em pedaços, o texto de um campo de texto do
 * objeto de primeiro nível. É o que mantém a resposta progressiva com saída
 * estruturada: o texto ao usuário aparece antes de o JSON terminar.
 *
 * Acompanha o estado léxico (dentro de string, escape, profundidade) em vez de
 * procurar `"reply":` no texto, que casaria com o mesmo trecho dentro de outro
 * campo. Não valida o JSON; isso é feito no fim, com o objeto completo.
 */
export class JsonFieldStreamer {
  private depth = 0;
  private inString = false;
  private escape = false;
  private unicode: string | null = null;
  private expectKey = false;
  private readingKey = false;
  private key = '';
  private valueKey: string | null = null;
  private inTarget = false;
  private finished = false;

  constructor(private readonly field: string) {}

  push(chunk: string): string {
    let out = '';
    for (const char of chunk) out += this.step(char);
    return out;
  }

  private step(char: string): string {
    if (this.finished) return '';
    return this.inString ? this.stringChar(char) : this.structuralChar(char);
  }

  private structuralChar(char: string): string {
    if (char === '{' || char === '[') {
      this.depth++;
      this.expectKey = char === '{' && this.depth === 1;
    } else if (char === '}' || char === ']') {
      this.depth--;
    } else if (this.depth === 1 && char === ',') {
      this.expectKey = true;
    } else if (this.depth === 1 && char === ':') {
      this.expectKey = false;
      this.valueKey = this.key;
    } else if (char === '"') {
      this.inString = true;
      if (this.depth === 1 && this.expectKey) {
        this.readingKey = true;
        this.key = '';
      } else if (this.depth === 1 && this.valueKey === this.field) {
        this.inTarget = true;
      }
    }
    return '';
  }

  private stringChar(char: string): string {
    let decoded: string;

    if (this.unicode !== null) {
      this.unicode += char;
      if (this.unicode.length < 4) return '';
      decoded = String.fromCharCode(parseInt(this.unicode, 16));
      this.unicode = null;
    } else if (this.escape) {
      this.escape = false;
      if (char === 'u') {
        this.unicode = '';
        return '';
      }
      decoded = ESCAPES[char] ?? '';
    } else if (char === '\\') {
      this.escape = true;
      return '';
    } else if (char === '"') {
      this.inString = false;
      if (this.readingKey) this.readingKey = false;
      if (this.inTarget) {
        this.inTarget = false;
        this.finished = true;
      }
      return '';
    } else {
      decoded = char;
    }

    if (this.readingKey) this.key += decoded;
    return this.inTarget ? decoded : '';
  }
}
