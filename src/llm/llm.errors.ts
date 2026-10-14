export type LlmErrorKind =
  | 'indisponivel'
  | 'tempo_esgotado'
  | 'cancelado'
  | 'ocupado'
  | 'resposta_invalida';

const MESSAGES: Record<LlmErrorKind, string> = {
  indisponivel: 'O assistente está indisponível no momento.',
  tempo_esgotado: 'O assistente demorou demais para responder.',
  cancelado: 'A solicitação ao assistente foi cancelada.',
  ocupado: 'O assistente está atendendo muitas solicitações. Tente novamente.',
  resposta_invalida: 'O assistente devolveu uma resposta inesperada.',
};

/**
 * A mensagem é genérica e pode chegar ao usuário; o detalhe técnico fica só no
 * log do serviço (RNF08).
 */
export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind) {
    super(MESSAGES[kind]);
    this.name = 'LlmError';
  }
}
