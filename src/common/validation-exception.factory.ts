import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Erros de validacao agrupados pelo campo que os produziu. */
export type FieldErrors = Record<string, string[]>;

/**
 * Monta o corpo de erro de validacao com `fieldErrors` alem de `message`.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const fieldErrors = collectFieldErrors(errors);
  const message = Object.values(fieldErrors).flat();

  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message,
    fieldErrors,
  });
}

function collectFieldErrors(
  errors: ValidationError[],
  prefix = '',
  acc: FieldErrors = {},
): FieldErrors {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      acc[path] = [...(acc[path] ?? []), ...Object.values(error.constraints)];
    }

    if (error.children?.length) {
      collectFieldErrors(error.children, path, acc);
    }
  }

  return acc;
}
