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

  @ApiProperty({ enum: TransactionSource, enumName: 'TransactionSource' })
  source!: TransactionSource;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  updatedAt!: string;
}
