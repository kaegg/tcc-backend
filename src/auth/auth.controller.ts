import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService, type IssuedSession } from './auth.service';
import { type AuthenticatedUser, CurrentUser } from './current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { SESSION_INVALID_MESSAGE } from './jwt-auth.guard';
import { OriginGuard } from './origin.guard';
import { Public } from './public.decorator';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';
import { ACCOUNT_THROTTLE, IP_THROTTLE } from './throttling';

const MINUTE = 60_000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({
    [IP_THROTTLE]: { limit: 10, ttl: MINUTE },
    [ACCOUNT_THROTTLE]: { limit: 10, ttl: 15 * MINUTE },
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Campos invalidos.' })
  @ApiUnauthorizedResponse({
    description:
      'E-mail ou senha incorretos. A resposta e a mesma para e-mail sem conta e para senha errada.',
  })
  @ApiTooManyRequestsResponse({ description: 'Limite de tentativas excedido.' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(response, await this.auth.login(dto));
  }

  /**
   * Restaura a sessão a partir do cookie httpOnly. É o que o frontend chama ao
   * abrir a aplicação e ao receber 401, já que o access token vive só em memória.
   */
  @Public()
  @UseGuards(OriginGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Sem sessao valida.' })
  @ApiForbiddenResponse({ description: 'Origem nao autorizada.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const presented = readRefreshCookie(request);

    if (!presented) throw new UnauthorizedException(SESSION_INVALID_MESSAGE);

    try {
      return this.respond(response, await this.auth.refresh(presented));
    } catch (error) {
      // Cookie que não vale mais não deve continuar sendo reenviado.
      clearRefreshCookie(response, this.auth.secureCookie);
      throw error;
    }
  }

  /**
   * Pública de propósito: com o access token já vencido o usuário ainda precisa
   * conseguir sair. A sessão é identificada pelo cookie.
   */
  @Public()
  @UseGuards(OriginGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse({ description: 'Sessao encerrada.' })
  @ApiForbiddenResponse({ description: 'Origem nao autorizada.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    clearRefreshCookie(response, this.auth.secureCookie);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return this.auth.getProfile(user.id);
  }

  private respond(response: Response, issued: IssuedSession): AuthResponseDto {
    setRefreshCookie(
      response,
      issued.refreshToken,
      issued.refreshExpiresAt,
      this.auth.secureCookie,
    );

    return {
      accessToken: issued.accessToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresIn,
      user: issued.user,
    };
  }
}
