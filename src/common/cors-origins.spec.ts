import { buildCorsOriginChecker, parseCorsOrigins } from './cors-origins';

describe('parseCorsOrigins', () => {
  it('separa a lista por virgula', () => {
    expect(
      parseCorsOrigins('http://localhost:5173,http://127.0.0.1:5173'),
    ).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
  });

  it('ignora espacos ao redor de cada origem', () => {
    expect(parseCorsOrigins(' http://a.test , http://b.test ')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('remove a barra final, que o header Origin nunca traz', () => {
    expect(parseCorsOrigins('http://localhost:5173/')).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('normaliza a caixa', () => {
    expect(parseCorsOrigins('HTTP://LOCALHOST:5173')).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('descarta entradas vazias', () => {
    expect(parseCorsOrigins('http://a.test,,  ,')).toEqual(['http://a.test']);
  });

  it('devolve lista vazia quando a variavel nao esta definida', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
  });
});

describe('buildCorsOriginChecker', () => {
  const allowed = ['http://localhost:5173'];

  /** Executa o verificador e devolve o par (erro, permitido). */
  function check(
    origin: string | undefined,
    onRejected?: (origin: string) => void,
  ): { err: Error | null; allow: boolean | undefined } {
    let resultado: { err: Error | null; allow: boolean | undefined } = {
      err: null,
      allow: undefined,
    };

    buildCorsOriginChecker(allowed, onRejected)(origin, (err, allow) => {
      resultado = { err, allow };
    });

    return resultado;
  }

  it('libera origem que esta na lista', () => {
    expect(check('http://localhost:5173')).toEqual({ err: null, allow: true });
  });

  it('libera requisicao sem header Origin', () => {
    // curl, supertest e sondas de infraestrutura nao mandam Origin. CORS e uma
    // regra de navegador: sem Origin nao ha o que proteger.
    expect(check(undefined)).toEqual({ err: null, allow: true });
  });

  it('aceita origem que so difere pela barra final ou pela caixa', () => {
    expect(check('http://localhost:5173/').allow).toBe(true);
    expect(check('HTTP://LOCALHOST:5173').allow).toBe(true);
  });

  it('nega origem fora da lista SEM produzir erro', () => {
    // Com `new Error(...)` o pacote cors repassa ao next(), o filtro global
    // captura e a resposta vira 500 para todo mundo. A negacao correta e
    // simplesmente nao mandar os headers de CORS.
    expect(check('http://malicioso.test')).toEqual({
      err: null,
      allow: false,
    });
  });

  it('avisa quem chamou quando bloqueia uma origem', () => {
    const bloqueadas: string[] = [];

    check('http://malicioso.test', (origin) => bloqueadas.push(origin));

    expect(bloqueadas).toEqual(['http://malicioso.test']);
  });

  it('nega tudo que tem origem quando a lista esta vazia', () => {
    let allow: boolean | undefined;
    buildCorsOriginChecker([])('http://localhost:5173', (_err, permitido) => {
      allow = permitido;
    });

    expect(allow).toBe(false);
  });
});
