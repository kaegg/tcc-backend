import type { ChatMessage } from '../llm/ollama.service';

const MAX_CONVERSATIONS_PER_USER = 20;
const MAX_MESSAGES_PER_CONVERSATION = 12;
const IDLE_TTL_MS = 6 * 60 * 60 * 1000;

interface Entry {
  messages: ChatMessage[];
  touchedAt: number;
}

/**
 * Histórico curto da conversa, guardado no servidor e nunca recebido do
 * cliente: um histórico enviado pelo navegador permitiria forjar falas do
 * assistente e conduzir o modelo. Vive em memória e sobrevive à reconexão do
 * socket (renovação do token); a persistência em `chat_messages` não é desta
 * issue.
 */
export class ConversationMemory {
  private readonly byUser = new Map<string, Map<string, Entry>>();

  constructor(private readonly now: () => number = Date.now) {}

  history(userId: string, conversationId: string): ChatMessage[] {
    this.evictIdle();
    return [...(this.byUser.get(userId)?.get(conversationId)?.messages ?? [])];
  }

  append(
    userId: string,
    conversationId: string,
    ...messages: ChatMessage[]
  ): void {
    let conversations = this.byUser.get(userId);
    if (!conversations) {
      conversations = new Map();
      this.byUser.set(userId, conversations);
    }

    const entry = conversations.get(conversationId) ?? {
      messages: [],
      touchedAt: 0,
    };
    entry.messages = [...entry.messages, ...messages].slice(
      -MAX_MESSAGES_PER_CONVERSATION,
    );
    entry.touchedAt = this.now();

    conversations.delete(conversationId);
    conversations.set(conversationId, entry);

    while (conversations.size > MAX_CONVERSATIONS_PER_USER) {
      const [oldest] = conversations.keys();
      conversations.delete(oldest);
    }
  }

  forget(userId: string, conversationId: string): void {
    const conversations = this.byUser.get(userId);
    conversations?.delete(conversationId);
    if (conversations?.size === 0) this.byUser.delete(userId);
  }

  private evictIdle(): void {
    const limit = this.now() - IDLE_TTL_MS;
    for (const [userId, conversations] of this.byUser) {
      for (const [id, entry] of conversations) {
        if (entry.touchedAt < limit) conversations.delete(id);
      }
      if (conversations.size === 0) this.byUser.delete(userId);
    }
  }
}
