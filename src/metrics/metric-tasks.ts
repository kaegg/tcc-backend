/**
 * Tarefas medidas, iguais nos dois modos (RF26):
 * - `registro-despesa` / `registro-receita`: lançamento salvo ou confirmado;
 * - `registro`: cadastro que terminou sem gravar antes de o tipo ser conhecido;
 * - `consulta`: consulta de relatório (tela de Relatórios ou pergunta ao
 *   assistente).
 */
export const METRIC_TASKS = [
  'registro-despesa',
  'registro-receita',
  'registro',
  'consulta',
] as const;

export type MetricTask = (typeof METRIC_TASKS)[number];

export function taskKind(task: string): 'registro' | 'consulta' | '' {
  if (task.startsWith('registro')) return 'registro';
  return task === 'consulta' ? 'consulta' : '';
}
