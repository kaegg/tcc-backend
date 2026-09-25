import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.decorator';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto';
import {
  LANCAMENTO_NAO_ENCONTRADO,
  TransactionsService,
} from './transactions.service';

/**
 * Id que não é UUID responde 404 igual ao id inexistente, e não 400: a
 * resposta não distingue "formato errado" de "não é seu".
 */
function uuidOr404(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => new NotFoundException(LANCAMENTO_NAO_ENCONTRADO),
  });
}

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ type: TransactionResponseDto })
  @ApiBadRequestResponse({
    description:
      'Campos invalidos ou categoria incompativel. O corpo traz `fieldErrors`.',
  })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    return this.transactions.create(user.id, dto);
  }

  /** Só os lançamentos do usuário autenticado; o dono nunca vem da requisição. */
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: TransactionListResponseDto })
  @ApiBadRequestResponse({ description: 'Paginacao invalida.' })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponseDto> {
    return this.transactions.list(user.id, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiNotFoundResponse({
    description:
      'Nao existe, foi excluido ou pertence a outro usuario (sem distincao).',
  })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidOr404()) id: string,
  ): Promise<TransactionResponseDto> {
    return this.transactions.findOne(user.id, id);
  }
}
