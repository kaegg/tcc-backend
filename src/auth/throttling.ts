import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';

/** Contagem por endereço IP. */
export const IP_THROTTLE = 'ip';
/** Contagem por conta alvo, independente do IP de origem. */
export const ACCOUNT_THROTTLE = 'account';

/**
 * Os limites abaixo valem para toda rota; as rotas sensíveis os apertam com
 * `@Throttle`. O `account` existe porque só o limite por IP não detém um
 * ataque distribuído contra uma conta: a chave é o e-mail informado, que
 * chega normalizado pelo DTO ou, aqui, ainda cru.
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  errorMessage: 'Muitas tentativas. Aguarde um instante e tente novamente.',
  throttlers: [
    { name: IP_THROTTLE, ttl: 60_000, limit: 120 },
    {
      name: ACCOUNT_THROTTLE,
      ttl: 15 * 60_000,
      limit: 1_000,
      getTracker: (req) => {
        const request = req as Request;
        const body = (request.body ?? {}) as { email?: unknown };
        const { email } = body;

        return typeof email === 'string'
          ? `account:${email.trim().toLowerCase()}`
          : `ip:${request.ip ?? 'desconhecido'}`;
      },
    },
  ],
};
