import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Dados de criacao de conta.
 *
 * As mensagens repetem literalmente as do formulario: as duas interfaces do
 * estudo precisam reprovar a mesma coisa com o mesmo texto, senao a comparacao
 * entre elas acaba medindo a redacao do erro em vez do modo de interacao.
 */
export class CreateUserDto {
  @ApiProperty({ minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString({ message: 'Informe seu nome.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  @MinLength(3, { message: 'O nome deve ter pelo menos 3 caracteres.' })
  name!: string;

  /**
   * Normalizado para minusculas antes de validar.
   *
   * A tabela tem um CHECK exigindo `email = lower(email)` e o indice unico e
   * sobre a coluna crua. Sem normalizar aqui, um e-mail com maiuscula viola o
   * CHECK e vira erro interno, e o mesmo endereco em caixas diferentes escapa
   * da verificacao de duplicidade.
   */
  @ApiProperty({ maxLength: 255, example: 'voce@exemplo.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(255, { message: 'O e-mail deve ter no máximo 255 caracteres.' })
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
  })
  @IsString({ message: 'Informe sua senha.' })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  })
  @Matches(/[0-9]/, { message: 'A senha deve conter pelo menos um número.' })
  @Matches(/[a-zA-Z]/, { message: 'A senha deve conter pelo menos uma letra.' })
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  password!: string;
}
