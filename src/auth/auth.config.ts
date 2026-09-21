import type { ConfigService } from '@nestjs/config';

const JWT_SECRET_MIN_LENGTH = 32;

export const JWT_ISSUER = 'intellifinance';
export const JWT_ALGORITHM = 'HS256';

export interface AuthSettings {
  jwtSecret: string;
  accessTtlSeconds: number;
  sessionTtlMs: number;
  secureCookie: boolean;
}

/**
 * Validada no boot: uma aplicação sem segredo forte não deve subir, em vez de
 * assinar tokens com um valor previsível.
 */
export function readAuthSettings(config: ConfigService): AuthSettings {
  const jwtSecret = config.get<string>('JWT_SECRET');

  if (!jwtSecret || jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET ausente ou com menos de ${JWT_SECRET_MIN_LENGTH} caracteres. ` +
        "Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }

  return {
    jwtSecret,
    accessTtlSeconds: positiveInt(config, 'ACCESS_TOKEN_TTL_MINUTES', 15) * 60,
    sessionTtlMs:
      positiveInt(config, 'SESSION_TTL_DAYS', 7) * 24 * 60 * 60 * 1000,
    secureCookie: config.get<string>('NODE_ENV') === 'production',
  };
}

function positiveInt(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} deve ser um inteiro positivo.`);
  }

  return value;
}
