const CANCEL =
  /^(?:(?:nao|ah|ok|entao|melhor)\s+)?(?:cancela|cancelar|cancele|cancelado|cancelo|deixa pra la|deixa para la|deixa quieto|deixa|esquece|esqueca|esquece isso|nao quero mais|nao precisa mais|nao precisa|desisto|desiste|aborta|abortar|para|pare|parar|nada|chega|nao vou registrar|nao registra|nao registre)(?:\s+(?:isso|tudo|ai|o lancamento|esse lancamento|este lancamento|essa operacao|esta operacao|por favor|pf|pfv|entao|mesmo|obrigado|obrigada|valeu))*$/;

const CONFIRM =
  /^(?:(?:sim|ok|isso|certo|beleza|perfeito|exato|correto|esta certo|ta certo|tudo certo)\s*)*(?:(?:pode\s+)?(?:confirmar|confirma|confirme|confirmo|confirmado|registrar|registra|registre|lancar|lanca|lance|salvar|salva|salve|gravar|grava|grave)|pode|sim|isso mesmo|esta certo|ta certo|tudo certo|correto)(?:\s+(?:sim|isso|ai|o lancamento|esse lancamento|este lancamento|por favor|pf|pfv|entao|mesmo|obrigado|obrigada|valeu))*$/;

/** Mensagem normalizada, sem pontuação e espaços repetidos. */
function compact(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "cancela", "deixa pra lá", "não quero mais": desistir do lançamento. */
export function isCancelCommand(normalized: string): boolean {
  return CANCEL.test(compact(normalized));
}

/**
 * "confirmo", "pode registrar", "sim": só vale com um lançamento completo
 * aguardando confirmação — sem ele, o texto segue o fluxo normal.
 */
export function isConfirmCommand(normalized: string): boolean {
  return CONFIRM.test(compact(normalized));
}

/**
 * Pergunta nova no meio do preenchimento ("qual meu saldo?"): vai para o
 * modelo, em vez de ser lida como resposta ao que foi perguntado.
 */
export function looksLikeQuestion(normalized: string): boolean {
  return (
    /\?\s*$/.test(normalized.trim()) ||
    /^(qual|quais|quanto|quantos|quantas|como|quando|onde|por que|porque|o que|me mostra|mostra|mostre|lista|liste|ajuda|socorro)\b/.test(
      compact(normalized),
    )
  );
}

/**
 * Resposta curta o bastante para ser lida só pelo extrator ("45", "ontem",
 * "alimentação", "o segundo"). Mensagem longa pode trazer contexto que só o
 * modelo entende — "foi no uber" pede a categoria Transporte.
 */
export function isShortAnswer(normalized: string): boolean {
  return compact(normalized).split(' ').filter(Boolean).length <= 6;
}
