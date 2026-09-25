import { ApiProperty } from '@nestjs/swagger';
import { PeriodSummaryResponseDto } from './period-summary-response.dto';

export class CategoryTotalDto {
  @ApiProperty()
  categoryId!: string;

  @ApiProperty({ example: 'Alimentação' })
  categoryName!: string;

  @ApiProperty({ example: '350.40', description: 'Soma da categoria no mês.' })
  total!: string;

  @ApiProperty()
  transactionCount!: number;

  @ApiProperty({
    example: '28.35',
    description:
      'Percentual do total do tipo, com duas casas. Arredondado, então a ' +
      'soma dos percentuais pode diferir de 100 em centésimos; a soma dos ' +
      '`total` é exata.',
  })
  share!: string;
}

/**
 * Resumo do mês (RF14): os totais do relatório por período mais a
 * distribuição de receitas e de despesas por categoria, do maior para o menor.
 */
export class MonthlySummaryResponseDto extends PeriodSummaryResponseDto {
  @ApiProperty({ example: '2026-09' })
  month!: string;

  @ApiProperty({ type: [CategoryTotalDto] })
  incomeByCategory!: CategoryTotalDto[];

  @ApiProperty({ type: [CategoryTotalDto] })
  expenseByCategory!: CategoryTotalDto[];
}
