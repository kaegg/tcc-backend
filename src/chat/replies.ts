/**
 * O que a resposta é para o usuário, para a interface marcar cada uma de forma
 * distinta (TCC-028):
 * - `pergunta`: falta dado ou há dúvida, e o assistente pergunta;
 * - `confirmacao`: lançamento completo, aguardando a confirmação do usuário;
 * - `sucesso`: lançamento registrado ou consulta respondida;
 * - `erro`: o pedido não pôde ser atendido como foi feito;
 * - `informacao`: ajuda, cancelamento e assuntos fora do escopo.
 */
export type ReplyKind =
  'pergunta' | 'confirmacao' | 'sucesso' | 'erro' | 'informacao';

/**
 * Ajuda com exemplos que o sistema de fato entende: os valores, as datas e as
 * categorias citados funcionam com os extratores e com as categorias do seed.
 */
export const HELP_REPLY = [
  'Posso registrar receitas e despesas e consultar seus relatórios. Exemplos:',
  '• Despesa: “gastei 45 reais no mercado ontem”',
  '• Receita: “recebi 3.000 de salário dia 5”',
  '• Relatório: “quanto gastei em setembro?” ou “qual meu saldo este mês?”',
  'Antes de gravar qualquer lançamento, mostro os dados para você confirmar.',
].join('\n');

/**
 * Pedido de recomendação, e não de dado: "devo investir?", "vale a pena
 * financiar?". Só escolhe o texto da recusa; quem decide que está fora do
 * escopo é a intenção.
 */
const ADVICE =
  /\b(invest\w*|aplicar|aplicacao|acoes|bolsa de valores|cripto\w*|bitcoin|tesouro direto|cdb|lci|lca|fundos? de|previdencia|emprestimo|financiamento|financiar|consorcio|vale a pena|devo (?:comprar|vender|investir|gastar|economizar|pagar|guardar)|o que (?:eu )?(?:faco|devo fazer) com|como (?:posso )?(?:economizar|enriquecer|ficar rico)|me (?:aconselh|recomend|indic)\w*|dica\w*)\b/;

export function outOfScopeReply(normalized: string): string {
  if (ADVICE.test(normalized)) {
    return 'Não dou recomendações de investimento nem aconselhamento financeiro profissional — para isso, procure um profissional habilitado. Posso mostrar seus números, por exemplo: “qual meu saldo este mês?” ou “quanto gastei com alimentação em setembro?”.';
  }
  return 'Só consigo ajudar com seus lançamentos e relatórios no IntelliFinance. Por exemplo: “gastei 30 no uber hoje” ou “quanto gastei este mês?”. Para ver mais exemplos, escreva “ajuda”.';
}
