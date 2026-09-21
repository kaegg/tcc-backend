import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IP_THROTTLE } from '../auth/throttling';
import { Public } from '../auth/public.decorator';
import { CreateUserDto } from './dto/create-user.dto';
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
}
