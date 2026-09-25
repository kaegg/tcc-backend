import { ApiProperty } from '@nestjs/swagger';
import { Validate } from 'class-validator';
import { DateConstraint } from '../../transactions/dto/create-transaction.dto';
import { PeriodOrderConstraint } from '../../transactions/dto/list-transactions-query.dto';

/**
 * Período do relatório. As duas pontas são obrigatórias e inclusivas, com a
 * mesma regra de data do cadastro e dos filtros da listagem: o relatório e a
 * lista filtrada pelo mesmo período precisam enxergar os mesmos lançamentos.
 */
export class ReportPeriodQueryDto {
  @ApiProperty({ example: '2026-09-01', description: 'Início, inclusive.' })
  @Validate(DateConstraint)
  from!: string;

  @ApiProperty({ example: '2026-09-30', description: 'Fim, inclusive.' })
  @Validate(DateConstraint)
  @Validate(PeriodOrderConstraint)
  to!: string;
}
