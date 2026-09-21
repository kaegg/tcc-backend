import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { UsersModule } from '../users/users.module';
import { readAuthSettings } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { OriginGuard } from './origin.guard';
import { throttlerOptions } from './throttling';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ThrottlerModule.forRoot(throttlerOptions),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: readAuthSettings(config).jwtSecret,
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    OriginGuard,
    // A ordem importa: o limite de requisicoes roda antes da autenticacao, para
    // que tentativas com token invalido tambem sejam contadas.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [AuthController],
})
export class AuthModule {}
