import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_ALGORITHM, JWT_ISSUER } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';

export interface SocketUser {
  id: string;
  sessionId: string;
  /** Vencimento do access token apresentado no handshake, em ms. */
  expiresAt: number;
}

const MAX_TOKEN_LENGTH = 4096;

/**
 * Mesmas regras do JwtStrategy das rotas REST (algoritmo e emissor fixos,
 * sessão ativa no banco), aplicadas ao handshake do socket.
 */
@Injectable()
export class ChatAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async authenticate(token: unknown): Promise<SocketUser | null> {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }

    let payload: { sub?: unknown; sid?: unknown; exp?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
      });
    } catch {
      return null;
    }

    const { sub, sid, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof exp !== 'number'
    ) {
      return null;
    }

    const user = { id: sub, sessionId: sid, expiresAt: exp * 1000 };
    return (await this.isStillValid(user)) ? user : null;
  }

  /**
   * O socket fica aberto além da vida do token e de um logout; por isso cada
   * mensagem confere de novo o vencimento e a sessão.
   */
  async isStillValid(user: SocketUser): Promise<boolean> {
    if (user.expiresAt <= Date.now()) return false;
    return this.auth.isSessionActive(user.sessionId, user.id);
  }
}
