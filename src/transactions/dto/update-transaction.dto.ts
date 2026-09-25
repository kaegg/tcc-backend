import { PartialType } from '@nestjs/swagger';
import { CreateTransactionDto } from './create-transaction.dto';

/**
 * Alteração parcial, com os mesmos validadores do cadastro por herança.
 *
 * `skipNullProperties: false` troca o `@IsOptional` por "pular só quando
 * ausente": com o padrão, `{"amount": null}` passaria sem validação e
 * chegaria ao banco como NULL numa coluna NOT NULL, virando erro 500.
 */
export class UpdateTransactionDto extends PartialType(CreateTransactionDto, {
  skipNullProperties: false,
}) {}
