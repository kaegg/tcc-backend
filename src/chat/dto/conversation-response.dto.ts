import { ApiProperty } from '@nestjs/swagger';
import { ChatReplyKind, ChatRole } from '../../generated/prisma/enums';
import type { PendingSummary } from '../chat.service';

export class ConversationSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Começo da primeira mensagem do usuário.' })
  title!: string;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  updatedAt!: string;
}

export class ConversationListResponseDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  data!: ConversationSummaryDto[];
}

export class ReportPeriodDto {
  @ApiProperty({ example: '2026-09-01' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  to!: string;
}

export class ConversationMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ChatRole, enumName: 'ChatRole' })
  role!: ChatRole;

  @ApiProperty()
  content!: string;

  @ApiProperty({
    enum: ChatReplyKind,
    enumName: 'ChatReplyKind',
    nullable: true,
  })
  kind!: ChatReplyKind | null;

  @ApiProperty({ type: ReportPeriodDto, nullable: true })
  report!: ReportPeriodDto | null;
}

export class ConversationDetailDto extends ConversationSummaryDto {
  @ApiProperty({ type: [ConversationMessageDto] })
  messages!: ConversationMessageDto[];

  @ApiProperty({
    type: Object,
    nullable: true,
    description:
      'Lançamento ainda aguardando resposta nesta conversa, como no fim de `reply:end`.',
  })
  pending!: PendingSummary | null;
}
