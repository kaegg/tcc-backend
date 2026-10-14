/**
 * Resume uma falha para o log. Quem chama ainda precisa passar o resultado por
 * `redactSecrets`.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const partes = [error.name, error.message].filter(
    (parte) => parte && parte.length > 0,
  );

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) partes.push(`code=${code}`);

  if (error.cause instanceof Error && error.cause.message) {
    partes.push(`causa: ${error.cause.message}`);
  } else if (typeof error.cause === 'string') {
    partes.push(`causa: ${error.cause}`);
  }

  return partes.join(' | ') || error.constructor.name;
}
