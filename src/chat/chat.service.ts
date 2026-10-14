import { Injectable } from '@nestjs/common';
import {
  MAX_PROMPT_CHARS,
  OllamaService,
  type ChatMessage,
} from '../llm/ollama.service';
import { ConversationMemory } from './conversation-memory';

/**
 * Provisório até a TCC-023, que define intenções e saída estruturada. Diz ao
 * modelo o que ele ainda não faz, para que não afirme ter gravado algo (RF19).
 */
export const SYSTEM_PROMPT =
  'Você é o assistente do IntelliFinance, um sistema de gestão financeira ' +
  'pessoal. Responda sempre em português do Brasil, de forma breve e clara. ' +
  'Você ainda não consegue registrar, alterar ou consultar lançamentos: nunca ' +
  'diga que fez isso. Não dê aconselhamento financeiro profissional.';

@Injectable()
export class ChatService {
  private readonly memory = new ConversationMemory();

  constructor(private readonly llm: OllamaService) {}

  /**
   * O histórico só recebe a troca completa: uma resposta cancelada ou com
   * falha não entra, para o modelo não continuar de um texto pela metade.
   */
  async *streamReply(
    userId: string,
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    const userMessage: ChatMessage = { role: 'user', content };
    const messages = fitPrompt([
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.memory.history(userId, conversationId),
      userMessage,
    ]);

    let reply = '';
    for await (const chunk of this.llm.chatStream({ messages, signal })) {
      reply += chunk;
      yield chunk;
    }

    this.memory.append(userId, conversationId, userMessage, {
      role: 'assistant',
      content: reply,
    });
  }
}

/** Descarta as falas mais antigas até caber no teto do serviço do LLM. */
function fitPrompt(messages: ChatMessage[]): ChatMessage[] {
  const [system, ...rest] = messages;
  const size = (list: ChatMessage[]) =>
    list.reduce((total, message) => total + message.content.length, 0);

  while (rest.length > 1 && size([system, ...rest]) > MAX_PROMPT_CHARS) {
    rest.shift();
  }
  return [system, ...rest];
}
