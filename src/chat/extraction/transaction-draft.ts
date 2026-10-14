import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTransactionDto } from '../../transactions/dto/create-transaction.dto';
import { isComplete, type RegistrationState } from './registration';

/**
 * O lançamento que o chatbot pode propor, validado pelo mesmo DTO e com as
 * mesmas opções do `ValidationPipe` global que o formulário atravessa
 * (RNF12). `null` enquanto faltar dado, houver ambiguidade ou algum campo
 * reprovar: só um rascunho não nulo pode chegar à confirmação (TCC-026), e é
 * isso que impede gravar campo ausente ou inválido.
 */
export function buildTransactionDraft(
  state: RegistrationState,
): CreateTransactionDto | null {
  if (!isComplete(state)) return null;

  const { type, amount, category, date, description } = state.entities;
  const dto = plainToInstance(CreateTransactionDto, {
    type,
    amount,
    categoryId: category?.id,
    date,
    description,
  });

  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length === 0 ? dto : null;
}
