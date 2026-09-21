import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password';

/**
 * Regras de senha nova, uma só para cadastro e troca de senha: duas cópias
 * poderiam divergir e a política passaria a depender do caminho usado. As
 * mensagens repetem as do formulário do frontend.
 */
export const StrongPassword = () =>
  applyDecorators(
    ApiProperty({
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      format: 'password',
    }),
    IsString({ message: 'Informe sua senha.' }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    }),
    Matches(/[0-9]/, { message: 'A senha deve conter pelo menos um número.' }),
    Matches(/[a-zA-Z]/, {
      message: 'A senha deve conter pelo menos uma letra.',
    }),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    }),
  );
