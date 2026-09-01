import type { Prisma } from '../generated/prisma/client';

/**
 * Filtros de escopo reutilizaveis.
 */

/**
 * O lancamento pertence ao usuario e nao foi excluido.
 *
 * Usar em toda leitura de lancamento — listagem, detalhe, filtro e relatorio.
 * Para alcancar tambem os excluidos, montar o `where` explicitamente, para
 * que a excecao fique visivel na chamada.
 */
export const ownedActiveTransaction = (userId: string) =>
  ({ userId, deletedAt: null }) satisfies Prisma.TransactionWhereInput;

/** Aplicada a conversa do chatbot. */
export const ownedConversation = (userId: string) =>
  ({ userId }) satisfies Prisma.ConversationWhereInput;

/**
 * Aplicada a mensagem do chatbot. A posse vem da conversa: `chat_messages` nao tem
 * `user_id` proprio, justamente para nao poder divergir de `conversations.user_id`.
 */
export const ownedChatMessage = (userId: string) =>
  ({ conversation: { userId } }) satisfies Prisma.ChatMessageWhereInput;

/**
 * So categoria em circulacao aparece em formulario, filtro, relatorio
 * e nas opcoes oferecidas ao LLM. As categorias sao do sistema, compartilhadas
 * por todos os usuarios, entao aqui nao ha recorte por dono.
 */
export const activeCategory = {
  isActive: true,
} satisfies Prisma.CategoryWhereInput;
