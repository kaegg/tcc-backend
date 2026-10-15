import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.decorator';
import { ChatService } from './chat.service';
import {
  CONVERSA_NAO_ENCONTRADA,
  ConversationsService,
} from './conversations.service';
import {
  ConversationDetailDto,
  ConversationListResponseDto,
  ConversationSummaryDto,
} from './dto/conversation-response.dto';
import { RenameConversationDto } from './dto/rename-conversation.dto';

/** Id que não é UUID responde como conversa inexistente. */
function uuidOr404(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => new NotFoundException(CONVERSA_NAO_ENCONTRADA),
  });
}

/**
 * Histórico do chatbot. Gravar fica com o gateway, que é quem sabe o que foi
 * respondido: o cliente não envia falas do assistente.
 */
@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly chat: ChatService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ConversationListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Sessão inválida ou expirada.' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationListResponseDto> {
    return { data: await this.conversations.list(user.id) };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ConversationDetailDto })
  @ApiNotFoundResponse({ description: CONVERSA_NAO_ENCONTRADA })
  @ApiUnauthorizedResponse({ description: 'Sessão inválida ou expirada.' })
  async find(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidOr404()) id: string,
  ): Promise<ConversationDetailDto> {
    const conversation = await this.conversations.find(user.id, id);
    if (!conversation) throw new NotFoundException(CONVERSA_NAO_ENCONTRADA);
    return {
      ...conversation,
      pending: this.chat.pendingSummary(user.id, id),
    };
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ConversationSummaryDto })
  @ApiBadRequestResponse({ description: 'Nome vazio ou longo demais.' })
  @ApiNotFoundResponse({ description: CONVERSA_NAO_ENCONTRADA })
  @ApiUnauthorizedResponse({ description: 'Sessão inválida ou expirada.' })
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidOr404()) id: string,
    @Body() body: RenameConversationDto,
  ): Promise<ConversationSummaryDto> {
    const renamed = await this.conversations.rename(user.id, id, body.title);
    if (!renamed) throw new NotFoundException(CONVERSA_NAO_ENCONTRADA);
    return renamed;
  }

  /** Exclusão definitiva, com as mensagens; conversa alheia responde 404. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Conversa excluída.' })
  @ApiNotFoundResponse({ description: CONVERSA_NAO_ENCONTRADA })
  @ApiUnauthorizedResponse({ description: 'Sessão inválida ou expirada.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidOr404()) id: string,
  ): Promise<void> {
    if (!(await this.conversations.remove(user.id, id))) {
      throw new NotFoundException(CONVERSA_NAO_ENCONTRADA);
    }
    this.chat.forget(user.id, id);
  }
}
