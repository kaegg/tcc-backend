import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'refresh_token';

/** O cookie só viaja para as rotas que o usam, nunca para o restante da API. */
const COOKIE_PATH = '/api/auth';

function options(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    // Frontend e API precisam ser do mesmo site (mesmo domínio registrável).
    sameSite: 'strict',
    path: COOKIE_PATH,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...options(secure),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: Response, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE, options(secure));
}

/** Leitura mínima do header `Cookie`, para não adicionar dependência por um único valor. */
export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== REFRESH_COOKIE) continue;

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}
