import { toCsv, type MetricRow } from './metrics-csv';

const linha = (extra: Partial<MetricRow> = {}): MetricRow => ({
  participantCode: 'P07',
  sessionCode: 'S1',
  mode: 'formulario',
  taskCode: 'registro-despesa',
  startedAt: new Date('2026-10-14T15:00:00.000Z'),
  finishedAt: new Date('2026-10-14T15:00:42.500Z'),
  durationMs: 42_500,
  interactionCount: 12,
  errorCount: 1,
  outcome: 'sucesso',
  notes: null,
  ...extra,
});

const linhas = (csv: string) => csv.slice(1).trimEnd().split('\r\n');

describe('toCsv', () => {
  it('uma linha por tarefa, com a unidade de interação do modo', () => {
    const csv = toCsv([
      linha(),
      linha({ mode: 'assistente', interactionCount: 4 }),
    ]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(linhas(csv)).toEqual([
      'participante;sessao;modo;tarefa;tipo_tarefa;inicio;fim;duracao_ms;duracao_s;interacoes;unidade_interacao;erros;resultado;situacao;observacoes',
      'P07;S1;formulario;registro-despesa;registro;2026-10-14T15:00:00.000Z;2026-10-14T15:00:42.500Z;42500;42,5;12;cliques;1;sucesso;completa;',
      'P07;S1;assistente;registro-despesa;registro;2026-10-14T15:00:00.000Z;2026-10-14T15:00:42.500Z;42500;42,5;4;mensagens;1;sucesso;completa;',
    ]);
  });

  it('marca como incompleta a tarefa que começou e não terminou', () => {
    const [, incompleta] = linhas(
      toCsv([
        linha({
          finishedAt: null,
          durationMs: null,
          outcome: null,
          interactionCount: 0,
          errorCount: 0,
        }),
      ]),
    );

    expect(incompleta).toBe(
      'P07;S1;formulario;registro-despesa;registro;2026-10-14T15:00:00.000Z;;;;0;cliques;0;;incompleta;',
    );
  });

  it('com vírgula como separador, decimal com ponto e texto escapado', () => {
    const [cabecalho, dados] = linhas(
      toCsv(
        [linha({ outcome: 'falha', notes: 'Tempo "máximo", excedido.' })],
        ',',
      ),
    );

    expect(cabecalho.startsWith('participante,sessao,')).toBe(true);
    expect(dados).toContain(',42.5,');
    expect(
      dados.endsWith(',falha,completa,"Tempo ""máximo"", excedido."'),
    ).toBe(true);
  });
});
