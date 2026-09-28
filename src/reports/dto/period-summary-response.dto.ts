import { ApiProperty } from '@nestjs/swagger';

/**
 * Totais de um período (RF13).
 *
 * Os valores seguem o contrato de dinheiro da API: texto decimal com duas
 * casas. Receitas e despesas nunca são negativas; o saldo é o único valor com
 * sinal, porque é derivado (RN04: receitas − despesas).
 */
export class PeriodSummaryResponseDto {
  @ApiProperty({ example: '2026-09-01' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  to!: string;

  @ApiProperty({ example: '1750.10', description: 'Soma das receitas.' })
  income!: string;

  @ApiProperty({ example: '1820.00', description: 'Soma das despesas.' })
  expense!: string;

  @ApiProperty({
    example: '-69.90',
    description: 'Receitas menos despesas; pode ser negativo.',
  })
  balance!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '29.43',
    description:
      'Taxa de economia: saldo sobre receitas, em percentual com duas casas. ' +
      'Pode ser negativa; nula quando não há receita no período.',
  })
  savingsRate!: string | null;

  @ApiProperty({ description: 'Lançamentos considerados no período.' })
  transactionCount!: number;
}
