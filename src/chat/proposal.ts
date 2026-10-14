import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CATEGORIA_INVALIDA } from '../categories/categories.service';
import {
  validationExceptionFactory,
  type FieldErrors,
} from '../common/validation-exception.factory';
import type { TransactionType } from '../generated/prisma/enums';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';
import type { RegistrationState } from './extraction/registration';
import { buildTransactionDraft } from './extraction/transaction-draft';
import {
  emptyEntities,
  type InterpretationContext,
} from './interpretation/entities';
import type { PendingOperation } from './pending-operations';

/** O lançamento pronto que o cartão do assistente mostra para confirmação. */
export interface Proposal {
  id: string;
  type: TransactionType;
  amount: string;
  categoryId: string;
  categoryName: string;
  date: string;
  description: string | null;
  /** A data não foi dita pelo usuário: o sistema assumiu hoje. */
  dateDefaulted: boolean;
}

export function toProposal(operation: PendingOperation): Proposal | null {
  const draft = buildTransactionDraft(operation.state);
  const category = operation.state.entities.category;
  if (!draft || !category) return null;

  return {
    id: operation.id,
    type: draft.type,
    amount: draft.amount,
    categoryId: draft.categoryId,
    categoryName: category.name,
    date: draft.date,
    description: draft.description ?? null,
    dateDefaulted: operation.state.defaults.includes('date'),
  };
}

/**
 * Lançamento corrigido pelo usuário no cartão. Passa pelo mesmo DTO, com as
 * mesmas opções e as mesmas mensagens por campo do `ValidationPipe` global que
 * o formulário atravessa (RNF12); a categoria precisa estar entre as ativas e
 * ser do tipo escolhido, como no `CategoriesService.assertUsable`.
 */
export function stateFromEdit(
  values: Record<string, unknown>,
  context: InterpretationContext,
): { state: RegistrationState } | { fieldErrors: FieldErrors } {
  const dto = plainToInstance(CreateTransactionDto, values);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    const body = validationExceptionFactory(errors).getResponse() as {
      fieldErrors: FieldErrors;
    };
    return { fieldErrors: body.fieldErrors };
  }

  const category = context.categories.find(
    (item) => item.id === dto.categoryId && item.type === dto.type,
  );
  if (!category) return { fieldErrors: { categoryId: [CATEGORIA_INVALIDA] } };

  return {
    state: {
      entities: {
        ...emptyEntities(),
        type: dto.type,
        amount: dto.amount,
        date: dto.date,
        category: { id: category.id, name: category.name },
        description: dto.description ?? null,
      },
      clarifications: [],
      defaults: [],
    },
  };
}
