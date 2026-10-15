import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
} from './dto/conversation-response.dto';

/**
 * Leitura do histórico. Gravar fica com o gateway, que é quem sabe o que foi
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
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () => new NotFoundException(CONVERSA_NAO_ENCONTRADA),
      }),
    )
    id: string,
  ): Promise<ConversationDetailDto> {
    const conversation = await this.conversations.find(user.id, id);
    if (!conversation) throw new NotFoundException(CONVERSA_NAO_ENCONTRADA);
    return {
      ...conversation,
      pending: this.chat.pendingSummary(user.id, id),
    };
  }
}
