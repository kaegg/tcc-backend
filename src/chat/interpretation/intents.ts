import type { EntityName } from './entities';

export interface IntentDefinition {
  name: string;
  /** Vai para a instrução de sistema; é como o modelo distingue as intenções. */
  description: string;
  /** Campos que a intenção aceita; os demais são descartados na validação. */
  entities: readonly EntityName[];
  /** Sem eles a operação não pode seguir (TCC-025 pergunta pelo que falta). */
  required: readonly EntityName[];
  /** Usada quando o modelo não devolve resposta textual aproveitável. */
  fallbackReply: string;
  /**
   * `false` quando o backend escreve a resposta a partir dos dados validados:
   * o modelo deixa `reply` vazio e nada dele é exibido.
   */
  modelReply?: boolean;
}

/**
 * Registro das intenções do chatbot. Uma intenção nova é uma entrada aqui: o
 * esquema enviado ao Ollama, a instrução de sistema e a validação são gerados
 * a partir desta lista.
 *
 * `registrar_lancamento` não exige a data: o formulário assume hoje quando o
 * usuário não informa, e o chatbot segue a mesma regra (TCC-024).
 *
 * Nas consultas, o modelo só escolhe a intenção (e sugere tipo e categoria): o
 * período sai do texto (`extraction/periods.ts`) e os números, do
 * `ReportsService` (TCC-027).
 */
export const INTENTS = [
  {
    name: 'registrar_lancamento',
    description:
      'o usuário relata uma receita ou despesa que aconteceu e quer registrá-la',
    entities: ['type', 'amount', 'date', 'category', 'description'],
    required: ['type', 'amount', 'category'],
    fallbackReply: 'Entendi que você quer registrar um lançamento.',
    modelReply: false,
  },
  {
    name: 'consultar_relatorio',
    description:
      'o usuário pergunta por totais, saldo, gastos ou receitas de um período, opcionalmente de uma categoria',
    entities: ['type', 'category', 'periodStart', 'periodEnd'],
    required: ['periodStart', 'periodEnd'],
    fallbackReply: 'Entendi que você quer consultar seus lançamentos.',
    modelReply: false,
  },
  {
    name: 'obter_resumo',
    description:
      'o usuário pede o resumo de um mês: receitas, despesas, saldo e distribuição por categoria',
    entities: ['periodStart', 'periodEnd'],
    required: ['periodStart', 'periodEnd'],
    fallbackReply: 'Entendi que você quer o resumo do mês.',
    modelReply: false,
  },
  {
    name: 'ajuda',
    description:
      'o usuário cumprimenta, pergunta o que o assistente faz ou como usá-lo',
    entities: [],
    required: [],
    fallbackReply:
      'Posso registrar receitas e despesas e consultar seus relatórios. Por exemplo: "gastei 45 reais no mercado hoje".',
  },
  {
    name: 'fora_do_escopo',
    description:
      'qualquer outro assunto, inclusive pedidos de aconselhamento financeiro profissional',
    entities: [],
    required: [],
    fallbackReply:
      'Só consigo ajudar com seus lançamentos e relatórios no IntelliFinance.',
  },
] as const satisfies readonly IntentDefinition[];

export type IntentName = (typeof INTENTS)[number]['name'];

export function findIntent(
  name: unknown,
  intents: readonly IntentDefinition[] = INTENTS,
): IntentDefinition | undefined {
  return intents.find((intent) => intent.name === name);
}
