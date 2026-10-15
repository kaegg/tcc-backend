import { Injectable } from '@nestjs/common';
import type { ChatReplyKind, ChatRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ownedConversation } from '../prisma/scopes';
import {
  civilDateToUtc,
  utcToCivilDate,
} from '../transactions/dto/transaction-rules';
import type {
  ConversationDetailDto,
  ConversationSummaryDto,
} from './dto/conversation-response.dto';

const RECENT_CONVERSATIONS = 20;
const MAX_TITLE_CHARS = 120;
export const UNTITLED_CONVERSATION = 'Nova conversa';
export const CONVERSA_NAO_ENCONTRADA = 'Conversa não encontrada.';

export interface RecordedMessage {
  role: ChatRole;
  content: string;
  kind?: ChatReplyKind;
  report?: { from: string; to: string } | null;
}

const SUMMARY = { id: true, title: true, updatedAt: true } as const;

/**
 * Conversas gravadas em `conversations`/`chat_messages`, para o usuário
 * reabrir o histórico. É só registro do que a tela mostrou: o contexto que vai
 * ao modelo continua no `ConversationMemory`, que nunca é lido daqui nem do
 * cliente.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A conversa nasce na primeira troca, com o id gerado pelo navegador. O
   * `where` leva o dono: um id que já pertence a outro usuário não casa, cai
   * no `create` e falha pela chave primária, sem tocar na conversa alheia.
   */
  async record(
    userId: string,
    conversationId: string,
    messages: RecordedMessage[],
  ): Promise<void> {
    const now = Date.now();
    // Instantes distintos mantêm a ordem da troca: as falas são gravadas
    // juntas e o `uuid(7)` não garante ordem dentro do mesmo milissegundo.
    const rows = messages.map((message, index) => ({
      role: message.role,
      content: message.content,
      kind: message.kind ?? null,
      reportFrom: message.report ? civilDateToUtc(message.report.from) : null,
      reportTo: message.report ? civilDateToUtc(message.report.to) : null,
      createdAt: new Date(now + index),
    }));
    const firstUser = messages.find((message) => message.role === 'user');

    await this.prisma.conversation.upsert({
      where: { id: conversationId, ...ownedConversation(userId) },
      create: {
        id: conversationId,
        userId,
        title: titleOf(firstUser?.content),
        messages: { create: rows },
      },
      update: { updatedAt: new Date(now), messages: { create: rows } },
    });
  }

  async list(userId: string): Promise<ConversationSummaryDto[]> {
    const rows = await this.prisma.conversation.findMany({
      where: ownedConversation(userId),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: RECENT_CONVERSATIONS,
      select: SUMMARY,
    });
    return rows.map(toSummary);
  }

  async find(
    userId: string,
    conversationId: string,
  ): Promise<Omit<ConversationDetailDto, 'pending'> | null> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...ownedConversation(userId) },
      select: {
        ...SUMMARY,
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            role: true,
            content: true,
            kind: true,
            reportFrom: true,
            reportTo: true,
          },
        },
      },
    });
    if (!row) return null;

    return {
      ...toSummary(row),
      messages: row.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        kind: message.kind,
        report:
          message.reportFrom && message.reportTo
            ? {
                from: utcToCivilDate(message.reportFrom),
                to: utcToCivilDate(message.reportTo),
              }
            : null,
      })),
    };
  }
}

function titleOf(content: string | undefined): string {
  const title = content?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  return title || UNTITLED_CONVERSATION;
}

function toSummary(row: {
  id: string;
  title: string;
  updatedAt: Date;
}): ConversationSummaryDto {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}
