import { ApiProperty } from '@nestjs/swagger';
import { CategoryTotalDto } from './monthly-summary-response.dto';
import { PeriodSummaryResponseDto } from './period-summary-response.dto';

/** Um mês da série, recortado pelas pontas do período. */
export class MonthTotalsDto {
  @ApiProperty({ example: '2026-09' })
  month!: string;

  @ApiProperty({ example: '2026-09-01' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  to!: string;

  @ApiProperty({ example: '3500.00' })
  income!: string;

  @ApiProperty({ example: '1440.50' })
  expense!: string;

  @ApiProperty({ example: '2059.50' })
  balance!: string;

  @ApiProperty()
  transactionCount!: number;
}

/**
 * Visão completa do período para a tela de relatórios (RF15). Totais,
 * distribuição e série mensal vêm da mesma consulta: a soma dos meses e a
 * soma das categorias são iguais aos totais.
 */
export class ReportOverviewResponseDto extends PeriodSummaryResponseDto {
  @ApiProperty({ type: [CategoryTotalDto] })
  incomeByCategory!: CategoryTotalDto[];

  @ApiProperty({ type: [CategoryTotalDto] })
  expenseByCategory!: CategoryTotalDto[];

  @ApiProperty({
    type: [MonthTotalsDto],
    description: 'Todos os meses do período, inclusive os sem lançamento.',
  })
  months!: MonthTotalsDto[];
}
