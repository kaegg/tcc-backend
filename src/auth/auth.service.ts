import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { hashPassword, verifyPassword } from '../users/password';
import { UsersService } from '../users/users.service';
import {
  type AuthSettings,
  JWT_ALGORITHM,
  JWT_ISSUER,
  readAuthSettings,
} from './auth.config';
import type { LoginDto } from './dto/login.dto';
import { SESSION_INVALID_MESSAGE } from './jwt-auth.guard';

export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou senha incorretos.';

/**
 * Duas abas restaurando a sessão ao mesmo tempo apresentam o mesmo refresh
 * token: a segunda chega com o token que a primeira acabou de trocar. Dentro
 * desta janela isso é corrida legítima e apenas a segunda é recusada; fora
 * dela, token antigo reaparecendo indica cópia do cookie.
 */
const ROTATION_GRACE_MS = 10_000;

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  user: UserResponseDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const newRefreshToken = (): string => randomBytes(48).toString('base64url');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly settings: AuthSettings;
  private dummyHash?: Promise<string>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {
    this.settings = readAuthSettings(config);
  }

  get secureCookie(): boolean {
    return this.settings.secureCookie;
  }

  async login(dto: LoginDto): Promise<IssuedSession> {
    const credentials = await this.users.findCredentialsByEmail(dto.email);

    // Com e-mail desconhecido o hash é conferido mesmo assim, contra um hash
    // descartável: sem isso o tempo de resposta revelaria quais e-mails têm conta.
    const hash = credentials?.passwordHash ?? (await this.getDummyHash());
    const valid = await verifyPassword(hash, dto.password);

    if (!credentials || !valid) {
      this.logger.warn('Login recusado.');
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const refreshToken = newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.settings.sessionTtlMs);

    const session = await this.prisma.session.create({
      data: {
        userId: credentials.id,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    this.logger.log(`Login: usuario ${credentials.id}, sessao ${session.id}.`);

    return {
      accessToken: await this.signAccessToken(credentials.id, session.id),
      expiresIn: this.settings.accessTtlSeconds,
      user: {
        id: credentials.id,
        name: credentials.name,
        email: credentials.email,
        createdAt: credentials.createdAt.toISOString(),
      },
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Troca o refresh token por um novo par. O token apresentado deixa de valer
   * na hora (rotação), então cada token é de uso único.
   */
  async refresh(presented: string): Promise<IssuedSession> {
    const presentedHash = sha256(presented);
    const now = new Date();

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: { id: true, name: true, email: true, createdAt: true },
        },
      },
    });

    if (!session) {
      await this.handlePossibleReuse(presentedHash, now);
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }

    if (session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }

    const refreshToken = newRefreshToken();

    // A condição no `where` torna a troca atômica: de duas requisições
    // simultâneas com o mesmo token, só uma encontra a linha ainda com o hash antigo.
    const rotated = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: presentedHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: sha256(refreshToken),
        previousRefreshTokenHash: presentedHash,
        rotatedAt: now,
      },
    });

    if (rotated.count !== 1) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }

    return {
      accessToken: await this.signAccessToken(session.user.id, session.id),
      expiresIn: this.settings.accessTtlSeconds,
      user: {
        ...session.user,
        createdAt: session.user.createdAt.toISOString(),
      },
      refreshToken,
      refreshExpiresAt: session.expiresAt,
    };
  }

  /** Idempotente: encerrar uma sessão que já não existe não é erro. */
  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;

    const hash = sha256(presented);

    await this.prisma.session.updateMany({
      where: {
        OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }],
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.session.count({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    return count === 1;
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    if (!user) throw new UnauthorizedException(SESSION_INVALID_MESSAGE);

    return { ...user, createdAt: user.createdAt.toISOString() };
  }

  private async handlePossibleReuse(
    presentedHash: string,
    now: Date,
  ): Promise<void> {
    const stale = await this.prisma.session.findUnique({
      where: { previousRefreshTokenHash: presentedHash },
      select: { id: true, revokedAt: true, rotatedAt: true },
    });

    if (!stale || stale.revokedAt) return;

    const withinGrace =
      stale.rotatedAt !== null &&
      now.getTime() - stale.rotatedAt.getTime() <= ROTATION_GRACE_MS;
    if (withinGrace) return;

    await this.prisma.session.update({
      where: { id: stale.id },
      data: { revokedAt: now },
    });
    this.logger.warn(`Refresh token reutilizado: sessao ${stale.id} revogada.`);
  }

  private signAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      {
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        expiresIn: this.settings.accessTtlSeconds,
      },
    );
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
