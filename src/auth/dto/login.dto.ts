import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../users/password';

/**
 * Sem as regras de composição da senha do cadastro: no login, dizer "a senha
 * precisa de um número" revelaria a política a quem só tenta adivinhar. O teto
 * de tamanho fica, para que ninguém ocupe a CPU com uma senha enorme.
 */
export class LoginDto {
  @ApiProperty({ example: 'voce@exemplo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(255, { message: 'Informe um e-mail válido.' })
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString({ message: 'Informe sua senha.' })
  @IsNotEmpty({ message: 'Informe sua senha.' })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  })
  password!: string;
}
