import { ApiProperty } from '@nestjs/swagger';
import {
  TransactionSource,
  TransactionType,
} from '../../generated/prisma/enums';

/**
 * Lançamento como o cliente o vê.
 *
 * `userId` e `deletedAt` não saem: o dono é sempre o usuário autenticado, e
 * a exclusão lógica é detalhe interno.
 */
export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TransactionType, enumName: 'TransactionType' })
  type!: TransactionType;

  @ApiProperty({
    example: '35.90',
    description: 'Texto decimal com duas casas, sempre positivo.',
  })
  amount!: string;

  @ApiProperty({ example: '2026-09-21', description: 'Data civil AAAA-MM-DD.' })
  date!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty({
    description: 'Nome da categoria, para exibir sem nova consulta.',
  })
  categoryName!: string;

  @ApiProperty({ enum: TransactionSource, enumName: 'TransactionSource' })
  source!: TransactionSource;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  updatedAt!: string;
}

export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ description: 'Total de lançamentos do usuário.' })
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  data!: TransactionResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
