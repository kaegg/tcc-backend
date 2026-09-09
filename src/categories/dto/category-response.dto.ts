import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '../../generated/prisma/enums';

/**
 * Categoria como o cliente a ve.
 *
 * `isActive` e os carimbos de tempo nao saem: toda categoria devolvida por
 * `GET /api/categories` esta ativa por construcao. O campo entra na TCC-011,
 * no endpoint administrativo que precisar dele.
 */
export class CategoryResponseDto {
  @ApiProperty({
    description:
      'Identificador opaco. O cliente nunca deve construir nem interpretar ' +
      'este valor.',
  })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: TransactionType, enumName: 'TransactionType' })
  type!: TransactionType;
}

/**
 * Envelope de colecao.
 *
 * Toda colecao da API responde `{ "data": [...] }`. Custa uma linha agora e
 * evita uma quebra de contrato coordenada entre os dois repositorios quando
 * `transactions` (TCC-012) precisar acrescentar `meta` de paginacao.
 */
export class CategoryListResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  data!: CategoryResponseDto[];
}
