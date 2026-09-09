import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TransactionType } from '../../generated/prisma/enums';

/**
 * Filtros de `GET /api/categories`.
 *
 * O sufixo `.dto.ts` e obrigatorio: o plugin de CLI do `@nestjs/swagger`
 * (ligado em `nest-cli.json`) so processa arquivos com esse nome. Com outro
 * sufixo o parametro sumiria da documentacao, sem erro nenhum.
 */
export class ListCategoriesQueryDto {
  @ApiPropertyOptional({
    enum: TransactionType,
    enumName: 'TransactionType',
    description: 'Restringe a lista as categorias de receita ou de despesa.',
  })
  @IsOptional()
  @IsEnum(TransactionType, {
    message: 'type deve ser receita ou despesa.',
  })
  type?: TransactionType;
}
