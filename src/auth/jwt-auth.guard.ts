import {
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

export const SESSION_INVALID_MESSAGE = 'Sessão inválida ou expirada.';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // O socket do chatbot (TCC-022) não é HTTP e terá guard próprio.
    if (isPublic || context.getType() !== 'http') return true;

    return super.canActivate(context);
  }

  /** Mesma mensagem para token ausente, malformado, expirado ou de sessão revogada. */
  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    return user;
  }
}
