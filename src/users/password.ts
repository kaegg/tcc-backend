import * as argon2 from 'argon2';

/**
 * Parametros do hash de senha (RNF07).
 *
 * Sao os padroes atuais da biblioteca, declarados aqui de proposito: fixados,
 * uma mudanca de padrao numa atualizacao nao enfraquece o hash em silencio.
 * Ficam acima do minimo recomendado pela OWASP para Argon2id (19 MiB, t=2, p=1).
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

/**
 * Limite de tamanho da senha.
 *
 * O Argon2 nao trunca nem precisa de teto para funcionar; o teto existe para
 * que ninguem consiga ocupar a CPU do servidor mandando uma senha enorme.
 */
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(plainText: string): Promise<string> {
  return argon2.hash(plainText, ARGON2_OPTIONS);
}
