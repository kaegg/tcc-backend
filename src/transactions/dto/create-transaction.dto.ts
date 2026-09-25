import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { TransactionType } from '../../generated/prisma/enums';
import { checkAmount, checkCivilDate } from './transaction-rules';

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Caracteres de controle, exceto tabulação e quebra de linha. NUL derruba a
 * gravação no PostgreSQL com erro interno, e os demais só servem para forjar
 * o que aparece nas listagens.
 */
export const NO_CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex -- os caracteres de controle sao o alvo
  '^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]*$',
);

@ValidatorConstraint({ name: 'transactionAmount' })
class AmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checkAmount(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    return checkAmount(args?.value) ?? 'Informe o valor.';
  }
}

@ValidatorConstraint({ name: 'transactionDate' })
export class DateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checkCivilDate(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    return checkCivilDate(args?.value) ?? 'Informe a data.';
  }
}

/**
 * Dados de um lançamento novo.
 *
 * Só existem os campos que o usuário escolhe. `userId`, `source`, `id` e os
 * carimbos de tempo não estão aqui de propósito: com `forbidNonWhitelisted`,
 * enviá-los é recusado, então ninguém cria lançamento em nome de outro
 * usuário nem se passa por "assistente".
 */
export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType, enumName: 'TransactionType' })
  @IsEnum(TransactionType, { message: 'O tipo deve ser receita ou despesa.' })
  type!: TransactionType;

  @ApiProperty({
    example: '35.90',
    description:
      'Texto decimal com ponto e até duas casas, maior que zero. Nunca ' +
      'número JSON.',
  })
  @Validate(AmountConstraint)
  amount!: string;

  @ApiProperty({
    description: 'Categoria ativa e do mesmo tipo do lançamento.',
  })
  @IsUUID(undefined, { message: 'Selecione uma categoria.' })
  categoryId!: string;

  @ApiProperty({ example: '2026-09-21', description: 'Data civil AAAA-MM-DD.' })
  @Validate(DateConstraint)
  date!: string;

  @ApiProperty({ minLength: 3, maxLength: 140 })
  @Transform(trim)
  @IsString({ message: 'Descreva o lançamento com pelo menos 3 caracteres.' })
  @Matches(NO_CONTROL_CHARS, {
    message: 'A descrição contém caracteres inválidos.',
  })
  @MaxLength(140, { message: 'A descrição deve ter no máximo 140 caracteres.' })
  @MinLength(3, {
    message: 'Descreva o lançamento com pelo menos 3 caracteres.',
  })
  description!: string;
}
