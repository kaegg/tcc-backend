import type { ValidationError } from 'class-validator';
import type { ApiErrorBody } from './filters/all-exceptions.filter';
import { validationExceptionFactory } from './validation-exception.factory';

const corpo = (errors: ValidationError[]): ApiErrorBody =>
  validationExceptionFactory(errors).getResponse() as ApiErrorBody;

describe('validationExceptionFactory', () => {
  it('agrupa as mensagens pelo campo', () => {
    const { fieldErrors } = corpo([
      {
        property: 'email',
        constraints: { isEmail: 'Informe um e-mail válido.' },
      },
    ]);

    expect(fieldErrors).toEqual({ email: ['Informe um e-mail válido.'] });
  });

  it('junta varias violacoes do mesmo campo', () => {
    const { fieldErrors } = corpo([
      {
        property: 'password',
        constraints: {
          minLength: 'A senha deve ter pelo menos 8 caracteres.',
          matches: 'A senha deve conter pelo menos um número.',
        },
      },
    ]);

    expect(fieldErrors?.password).toHaveLength(2);
  });

  it('mantem `message` como lista plana, o formato da TCC-004', () => {
    const { message, statusCode, error } = corpo([
      { property: 'name', constraints: { minLength: 'Nome curto.' } },
      { property: 'email', constraints: { isEmail: 'E-mail inválido.' } },
    ]);

    expect(message).toEqual(['Nome curto.', 'E-mail inválido.']);
    expect(statusCode).toBe(400);
    expect(error).toBe('Bad Request');
  });

  it('usa caminho pontuado em campo aninhado', () => {
    const { fieldErrors } = corpo([
      {
        property: 'periodo',
        children: [
          {
            property: 'inicio',
            constraints: { isDateString: 'Data inválida.' },
          },
        ],
      },
    ]);

    expect(fieldErrors).toEqual({ 'periodo.inicio': ['Data inválida.'] });
  });

  it('devolve corpo vazio quando nao ha restricao violada', () => {
    const { fieldErrors, message } = corpo([{ property: 'name' }]);

    expect(fieldErrors).toEqual({});
    expect(message).toEqual([]);
  });
});
