import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Paginação de `GET /api/transactions`.
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
}
