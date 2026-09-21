import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { IP_THROTTLE } from '../auth/throttling';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Limite mais apertado que o geral: e o unico endpoint publico que revela se
  // um e-mail ja tem conta (ADR 0004, decisao 8).
  @Public()
  @Throttle({ [IP_THROTTLE]: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description: 'Campos invalidos. O corpo traz `fieldErrors` por campo.',
  })
  @ApiConflictResponse({ description: 'Ja existe conta com este e-mail.' })
  @ApiTooManyRequestsResponse({ description: 'Limite de tentativas excedido.' })
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.users.create(dto);
  }

  /**
   * O usuário vem sempre do token: não existe `:id` na rota, então não há
   * parâmetro que permita apontar para o perfil de outra pessoa.
   *
   * O limite vale porque a senha atual é conferida aqui: um access token
   * roubado não pode virar um oráculo de tentativa de senha.
   */
  @Patch('me')
  @Header('Cache-Control', 'no-store')
  @Throttle({ [IP_THROTTLE]: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description: 'Campos invalidos ou senha atual incorreta.',
  })
  @ApiConflictResponse({ description: 'Ja existe conta com este e-mail.' })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.users.updateProfile(user.id, dto);
  }

  @Put('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @Throttle({ [IP_THROTTLE]: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiNoContentResponse({
    description:
      'Senha alterada; as demais sessoes do usuario foram encerradas.',
  })
  @ApiBadRequestResponse({
    description: 'Campos invalidos ou senha atual incorreta.',
  })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(user.id, user.sessionId, dto);
  }
}
