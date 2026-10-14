import type { LlmErrorKind } from '../llm/llm.errors';

export const CHAT_NAMESPACE = '/chat';

export const ChatEvent = {
  send: 'message:send',
  cancel: 'reply:cancel',
  chunk: 'reply:chunk',
  end: 'reply:end',
  error: 'reply:error',
  cancelOperation: 'operation:cancel',
  confirmOperation: 'operation:confirm',
  editOperation: 'operation:edit',
} as const;

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_PAYLOAD_BYTES = 16 * 1024;

export type ChatErrorCode =
  | LlmErrorKind
  | 'mensagem_invalida'
  | 'limite_excedido'
  | 'sessao_expirada'
  | 'operacao_inexistente'
  | 'operacao_alterada'
  | 'operacao_incompleta'
  | 'dados_invalidos'
  | 'erro_interno';

export const CHAT_ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  indisponivel: 'O assistente está indisponível no momento.',
  tempo_esgotado: 'O assistente demorou demais para responder.',
  cancelado: 'A resposta foi interrompida.',
  ocupado: 'O assistente ainda está respondendo. Aguarde um instante.',
  resposta_invalida: 'O assistente devolveu uma resposta inesperada.',
  mensagem_invalida: `Escreva uma mensagem de 1 a ${MAX_MESSAGE_CHARS} caracteres.`,
  limite_excedido: 'Muitas mensagens em pouco tempo. Aguarde um instante.',
  sessao_expirada: 'Sua sessão expirou. Entre novamente.',
  operacao_inexistente:
    'Este lançamento não está mais aguardando confirmação. Envie os dados de novo para registrar.',
  operacao_alterada:
    'Os dados deste lançamento mudaram. Confira a versão mais recente antes de continuar.',
  operacao_incompleta: 'Ainda faltam dados para registrar este lançamento.',
  dados_invalidos: 'Revise os dados do lançamento.',
  erro_interno: 'Não foi possível processar a mensagem.',
};

export interface SendMessagePayload {
  id: string;
  conversationId: string;
  content: string;
}

export type SendMessageAck =
  { ok: true } | { ok: false; code: ChatErrorCode; message: string };

export interface ReplyErrorPayload {
  id: string;
  code: ChatErrorCode;
  message: string;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseSendMessage(raw: unknown): SendMessagePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, conversationId, content } = raw as Record<string, unknown>;

  if (typeof id !== 'string' || !CLIENT_ID.test(id)) return null;
  if (typeof conversationId !== 'string' || !CLIENT_ID.test(conversationId)) {
    return null;
  }
  if (typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_CHARS) return null;

  return { id, conversationId, content: trimmed };
}

export function parseCancel(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id } = raw as Record<string, unknown>;
  return typeof id === 'string' && CLIENT_ID.test(id) ? id : null;
}

export function parseCancelOperation(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { conversationId } = raw as Record<string, unknown>;
  return typeof conversationId === 'string' && CLIENT_ID.test(conversationId)
    ? conversationId
    : null;
}

export interface OperationPayload {
  conversationId: string;
  proposalId: string;
}

export function parseConfirmOperation(raw: unknown): OperationPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { conversationId, proposalId } = raw as Record<string, unknown>;
  if (typeof conversationId !== 'string' || !CLIENT_ID.test(conversationId)) {
    return null;
  }
  if (typeof proposalId !== 'string' || !CLIENT_ID.test(proposalId)) {
    return null;
  }
  return { conversationId, proposalId };
}

/**
 * Só a forma do envelope; os campos do lançamento são validados pelo DTO do
 * formulário, que devolve a mensagem de cada campo.
 */
export function parseEditOperation(
  raw: unknown,
): (OperationPayload & { values: Record<string, unknown> }) | null {
  const operation = parseConfirmOperation(raw);
  if (!operation) return null;
  const { values } = raw as Record<string, unknown>;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return null;
  }
  return { ...operation, values: values as Record<string, unknown> };
}

export function chatError(code: ChatErrorCode) {
  return { code, message: CHAT_ERROR_MESSAGES[code] };
}
