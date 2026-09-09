/**
 * Lista de origens liberadas no CORS.
 *
 * Fica em arquivo proprio por dois motivos. O gateway Socket.IO da TCC-022 nao
 * herda `enableCors` nem o prefixo global: ele declara CORS proprio em
 * `@WebSocketGateway({ cors })` e vai reaproveitar estas funcoes. E, separado,
 * o parsing fica testavel em unitario, sem subir HTTP.
 */

/**
 * Normaliza `CORS_ORIGIN` para comparacao com o header `Origin`.
 *
 * A normalizacao existe porque o header nunca traz barra final e a comparacao
 * do navegador e sensivel a caixa: `http://localhost:5173/` ou
 * `HTTP://LOCALHOST:5173` no .env nao casariam com nada e bloqueariam tudo,
 * sem erro nenhum no servidor.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, '').toLowerCase())
    .filter((origin) => origin.length > 0);
}

/** Assinatura do callback de origem aceita pelo pacote `cors`. */
export type CorsOriginChecker = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

/**
 * Verificador de origem para `enableCors`.
 *
 * Origem ausente e liberada: CORS e uma regra de navegador, e requisicao sem
 * header `Origin` (curl, supertest, health check de infraestrutura) nao tem o
 * que proteger.
 *
 * Origem fora da lista responde `callback(null, false)`, e nao um `Error`. Com
 * `Error`, o pacote `cors` repassa ao `next()`, o AllExceptionsFilter captura e
 * a resposta vira 500 — inclusive para quem nem mandou `Origin`. Sem os headers
 * de CORS o navegador ja bloqueia a leitura da resposta, que e o efeito
 * desejado; a protecao esta na lista, nao no status de erro.
 */
export function buildCorsOriginChecker(
  allowedOrigins: string[],
  onRejected?: (origin: string) => void,
): CorsOriginChecker {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = origin.replace(/\/+$/, '').toLowerCase();

    if (allowedOrigins.includes(normalized)) {
      callback(null, true);
      return;
    }

    onRejected?.(origin);
    callback(null, false);
  };
}
