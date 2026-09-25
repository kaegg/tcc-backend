import { ApiProperty } from '@nestjs/swagger';
import {
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { checkMonth, MONTH_MESSAGES } from '../report-month';

@ValidatorConstraint({ name: 'referenceMonth' })
class MonthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checkMonth(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    return checkMonth(args?.value) ?? MONTH_MESSAGES.required;
  }
}

/**
 * Mês do resumo. Obrigatório: "o mês atual" depende do fuso de quem usa, e
 * quem sabe o fuso é o cliente (ADR 0012).
 */
export class MonthlySummaryQueryDto {
  @ApiProperty({
    example: '2026-09',
    description: 'Mês de referência AAAA-MM.',
  })
  @Validate(MonthConstraint)
  month!: string;
}
