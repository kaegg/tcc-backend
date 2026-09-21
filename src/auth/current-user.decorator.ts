import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

/**
 * Identidade vinda do token validado. Todo service que lê dado de usuário deve
 * receber o `id` daqui, e nunca de parâmetro de rota ou corpo: é isso que
 * impede um usuário de pedir o recurso de outro (RN01, RN07).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
      .user,
);
