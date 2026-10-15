import type { InteractionMode, TaskOutcome } from '../generated/prisma/enums';
import { taskKind } from './metric-tasks';

export interface MetricRow {
  participantCode: string;
  sessionCode: string;
  mode: InteractionMode;
  taskCode: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  interactionCount: number;
  errorCount: number;
  outcome: TaskOutcome | null;
  notes: string | null;
}

/** Sem ele, o Excel abre o UTF-8 como Latin-1 e estraga os acentos. */
const BOM = String.fromCharCode(0xfeff);

const UNIT: Record<InteractionMode, string> = {
  formulario: 'cliques',
  assistente: 'mensagens',
};

const COLUMNS = [
  'participante',
  'sessao',
  'modo',
  'tarefa',
  'tipo_tarefa',
  'inicio',
  'fim',
  'duracao_ms',
  'duracao_s',
  'interacoes',
  'unidade_interacao',
  'erros',
  'resultado',
  'situacao',
  'observacoes',
];

/**
 * Base de análise do estudo, uma linha por tarefa. Só códigos, tempos,
 * contagens e resultado: nenhuma coluna identifica pessoa ou conta.
 *
 * Com `;` (padrão), a duração em segundos usa vírgula decimal, que é o que o
 * Excel em português espera; com `,`, ponto. A tarefa que começou e não
 * terminou (desconexão, reinício do backend) sai como `incompleta`, para a
 * análise excluí-la de forma explícita (TCC-034).
 */
export function toCsv(rows: MetricRow[], separator: ',' | ';' = ';'): string {
  const decimal = separator === ';' ? ',' : '.';
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    const special = text.includes(separator) || /["\n\r]/.test(text);
    return special ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = rows.map((row) => {
    const complete = row.finishedAt !== null && row.outcome !== null;
    return [
      row.participantCode,
      row.sessionCode,
      row.mode,
      row.taskCode,
      taskKind(row.taskCode),
      row.startedAt.toISOString(),
      row.finishedAt?.toISOString() ?? null,
      row.durationMs,
      row.durationMs === null
        ? null
        : (row.durationMs / 1000).toFixed(1).replace('.', decimal),
      row.interactionCount,
      UNIT[row.mode],
      row.errorCount,
      row.outcome,
      complete ? 'completa' : 'incompleta',
      row.notes,
    ]
      .map(cell)
      .join(separator);
  });

  return `${BOM}${[COLUMNS.join(separator), ...lines].join('\r\n')}\r\n`;
}
