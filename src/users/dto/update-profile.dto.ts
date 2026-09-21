import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Alteração parcial do perfil. Só estes campos existem: com
 * `forbidNonWhitelisted`, `id`, `passwordHash` ou qualquer outro enviado no
 * corpo é recusado, e nenhum campo interno chega ao `update`.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Informe seu nome.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  @MinLength(3, { message: 'O nome deve ter pelo menos 3 caracteres.' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'voce@exemplo.com' })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(255, { message: 'O e-mail deve ter no máximo 255 caracteres.' })
  email?: string;

  @ApiPropertyOptional({
    format: 'password',
    description: 'Obrigatória quando o e-mail muda.',
  })
  @IsOptional()
  @IsString({ message: 'Informe sua senha atual.' })
  @IsNotEmpty({ message: 'Informe sua senha atual.' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'Senha atual incorreta.' })
  currentPassword?: string;
}
