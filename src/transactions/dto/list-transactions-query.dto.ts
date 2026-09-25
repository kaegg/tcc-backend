import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { TransactionType } from '../../generated/prisma/enums';
import {
  DateConstraint,
  NO_CONTROL_CHARS,
  trim,
} from './create-transaction.dto';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;

export const PERIODO_INVERTIDO =
  'A data final deve ser igual ou posterior à inicial.';

@ValidatorConstraint({ name: 'periodOrder' })
export class PeriodOrderConstraint implements ValidatorConstraintInterface {
  validate(to: unknown, args: ValidationArguments): boolean {
    const { from } = args.object as { from?: unknown };

    // Datas civis AAAA-MM-DD comparam certo como texto.
    return typeof from !== 'string' || typeof to !== 'string' || from <= to;
  }

  defaultMessage(): string {
    return PERIODO_INVERTIDO;
  }
}

/**
 * Paginação e filtros de `GET /api/transactions` (TCC-013, TCC-015).
 *
 * Os filtros se combinam por E. Não há filtro de dono: ele vem do token, e
 * `?userId=` continua recusado por `forbidNonWhitelisted`.
 */
export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um número inteiro.' })
  @Min(1, { message: 'page deve ser no mínimo 1.' })
  @Max(1_000_000, { message: 'page acima do limite.' })
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize deve ser um número inteiro.' })
  @Min(1, { message: 'pageSize deve ser no mínimo 1.' })
  @Max(MAX_PAGE_SIZE, {
    message: `pageSize deve ser no máximo ${MAX_PAGE_SIZE}.`,
  })
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Início do período, inclusive (AAAA-MM-DD).',
  })
  @IsOptional()
  @Validate(DateConstraint)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Fim do período, inclusive (AAAA-MM-DD).',
  })
  @IsOptional()
  @Validate(DateConstraint)
  @Validate(PeriodOrderConstraint)
  to?: string;

  @ApiPropertyOptional({ enum: TransactionType, enumName: 'TransactionType' })
  @IsOptional()
  @IsEnum(TransactionType, { message: 'O tipo deve ser receita ou despesa.' })
  type?: TransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID(undefined, { message: 'Categoria inválida.' })
  categoryId?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Trecho da descrição, sem diferenciar maiúsculas. `%` e `_` são ' +
      'buscados literalmente.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'A busca deve ser um texto.' })
  @Matches(NO_CONTROL_CHARS, {
    message: 'A busca contém caracteres inválidos.',
  })
  @MaxLength(MAX_SEARCH_LENGTH, {
    message: `A busca deve ter no máximo ${MAX_SEARCH_LENGTH} caracteres.`,
  })
  search?: string;
}
