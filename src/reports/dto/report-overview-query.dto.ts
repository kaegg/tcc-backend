import {
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DateConstraint } from '../../transactions/dto/create-transaction.dto';
import { PeriodOrderConstraint } from '../../transactions/dto/list-transactions-query.dto';
import { checkCivilDate } from '../../transactions/dto/transaction-rules';
import { monthSpan } from '../report-month';

export const MAX_OVERVIEW_MONTHS = 24;

export const PERIODO_LONGO = `O período deve ter no máximo ${MAX_OVERVIEW_MONTHS} meses.`;

@ValidatorConstraint({ name: 'overviewSpan' })
class OverviewSpanConstraint implements ValidatorConstraintInterface {
  validate(to: unknown, args: ValidationArguments): boolean {
    const { from } = args.object as { from?: unknown };

    // Data inválida já tem mensagem própria; aqui só a extensão.
    if (checkCivilDate(from) !== null || checkCivilDate(to) !== null) {
      return true;
    }

    return monthSpan(from as string, to as string) <= MAX_OVERVIEW_MONTHS;
  }

  defaultMessage(): string {
    return PERIODO_LONGO;
  }
}

/**
 * Mesmo período do relatório, com teto de extensão: a resposta traz um item
 * por mês, e sem limite um período de 2000 a 2100 devolveria 1.201 meses e
 * agruparia por dia um século de lançamentos numa só requisição.
 *
 * Não estende `ReportPeriodQueryDto` de propósito: redeclarar `to` numa
 * subclasse faz o class-validator descartar os validadores herdados daquela
 * propriedade, e o período invertido passaria sem erro (pego pelos testes).
 */
export class ReportOverviewQueryDto {
  @ApiProperty({ example: '2026-07-01', description: 'Início, inclusive.' })
  @Validate(DateConstraint)
  from!: string;

  @ApiProperty({
    example: '2026-09-30',
    description: `Fim, inclusive. No máximo ${MAX_OVERVIEW_MONTHS} meses de calendário.`,
  })
  @Validate(DateConstraint)
  @Validate(PeriodOrderConstraint)
  @Validate(OverviewSpanConstraint)
  to!: string;
}
