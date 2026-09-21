import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_ALGORITHM, JWT_ISSUER, readAuthSettings } from './auth.config';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: readAuthSettings(config).jwtSecret,
      // Fixar o algoritmo impede aceitar `alg: none` ou troca de HS para RS.
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      ignoreExpiration: false,
    });
  }

  async validate(
    payload: AccessTokenPayload,
  ): Promise<AuthenticatedUser | false> {
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      return false;
    }

    const active = await this.auth.isSessionActive(payload.sid, payload.sub);
    return active ? { id: payload.sub, sessionId: payload.sid } : false;
  }
}
