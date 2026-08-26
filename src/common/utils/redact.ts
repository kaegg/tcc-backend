/**
 * Remove credenciais de um texto antes dele chegar ao log.
 */

/** postgresql://usuario:senha@host -> postgresql://***:***@host */
const CONNECTION_URI = /\b([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi;

/** password=abc, senha: abc, token=abc, secret: abc */
const SECRET_FIELD =
  /\b(password|senha|secret|token|authorization|jwt_secret)(\s*[=:]\s*)(\S+)/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(CONNECTION_URI, '$1***:***@')
    .replace(SECRET_FIELD, '$1$2***');
}
