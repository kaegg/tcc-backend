import type { TransactionType } from '../../generated/prisma/enums';

const EXPENSE =
  /\b(gastei|gastou|gastamos|gasto|gastos|gastar|paguei|pagou|pagamos|pagar|pago|pagamento|comprei|comprou|compramos|comprar|compra|despesa|debitaram|debitou|saiu|sairam|perdi|torrei|desembolsei|saida)\b/;

const INCOME =
  /\b(recebi|recebeu|recebemos|receber|recebido|recebimento|ganhei|ganhou|ganhamos|ganho|entrou|entraram|entrada|receita|renda|vendi|vendemos|reembolso|reembolsaram|caiu na conta|depositaram|me pagaram|me pagou)\b/;

/**
 * Tipo indicado pelas palavras da mensagem, independente do modelo. Serve de
 * conferência: quando ele contradiz o tipo que o modelo escolheu, o sistema
 * pergunta em vez de escolher um dos dois. "me pagaram" vence "pagar" porque
 * o padrão de receita é testado como frase inteira.
 */
export function detectTypeHint(text: string): TransactionType | null {
  const income = INCOME.test(text);
  const expense = EXPENSE.test(text.replace(/\bme paga(ram|ou)\b/g, ''));

  if (income && !expense) return 'receita';
  if (expense && !income) return 'despesa';
  return null;
}

/** Resposta curta a "foi receita ou despesa?". */
export function readTypeAnswer(text: string): TransactionType | null {
  if (/\b(despesa|gasto|saida|paguei|gastei|comprei)\b/.test(text)) {
    return /\b(receita|entrada|recebi|ganhei)\b/.test(text) ? null : 'despesa';
  }
  if (/\b(receita|entrada|recebi|ganhei|ganho)\b/.test(text)) return 'receita';
  return null;
}
