import { extractDates } from './dates';
import { normalize } from './text';

/** Terça-feira. */
const HOJE = '2026-10-13';

const datas = (texto: string, referencia = HOJE) =>
  extractDates(normalize(texto), referencia).map((item) =>
    item.kind === 'resolvida' ? item.date : item.kind,
  );

describe('extractDates', () => {
  it.each([
    ['hoje', '2026-10-13'],
    ['ontem', '2026-10-12'],
    ['anteontem', '2026-10-11'],
    ['antes de ontem', '2026-10-11'],
    ['amanhã', '2026-10-14'],
    ['depois de amanhã', '2026-10-15'],
  ])('resolve "%s"', (texto, esperado) => {
    expect(datas(`paguei ${texto}`)).toEqual([esperado]);
  });

  it.each([
    ['há 3 dias', '2026-10-10'],
    ['ha tres dias', '2026-10-10'],
    ['há uma semana', '2026-10-06'],
    ['há duas semanas', '2026-09-29'],
    ['5 dias atrás', '2026-10-08'],
    ['dez dias atras', '2026-10-03'],
  ])('resolve "%s" contando a partir de hoje', (texto, esperado) => {
    expect(datas(texto)).toEqual([esperado]);
  });

  it.each([
    ['na sexta', '2026-10-09'],
    ['sexta passada', '2026-10-09'],
    ['sexta-feira', '2026-10-09'],
    ['na segunda', '2026-10-12'],
    ['domingo', '2026-10-11'],
    ['no sábado', '2026-10-10'],
    ['na terça', '2026-10-06'],
    ['terça passada', '2026-10-06'],
    ['última quarta', '2026-10-07'],
    ['sexta retrasada', '2026-10-02'],
    ['próxima sexta', '2026-10-16'],
    ['quinta que vem', '2026-10-15'],
  ])('resolve o dia da semana "%s" (hoje é terça)', (texto, esperado) => {
    expect(datas(texto)).toEqual([esperado]);
  });

  it.each([
    'paguei a segunda via do boleto',
    'é a quinta parcela',
    'na segunda vez que fui',
  ])('não lê ordinal como dia da semana: "%s"', (texto) => {
    expect(datas(texto)).toEqual([]);
  });

  it.each([
    ['12/10', '2026-10-12'],
    ['12/10/2026', '2026-10-12'],
    ['12/10/26', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['5 de outubro', '2026-10-05'],
    ['dia 5 de outubro', '2026-10-05'],
    ['1º de outubro', '2026-10-01'],
    ['primeiro de outubro', '2026-10-01'],
    ['5 de outubro de 2025', '2025-10-05'],
    ['dia 5', '2026-10-05'],
    ['dia primeiro', '2026-10-01'],
  ])('resolve a data "%s"', (texto, esperado) => {
    expect(datas(texto)).toEqual([esperado]);
  });

  it('sem ano, usa a ocorrência que já passou', () => {
    expect(datas('25/12')).toEqual(['2025-12-25']);
    expect(datas('dia 20')).toEqual(['2026-09-20']);
    expect(datas('dia 20', '2026-01-13')).toEqual(['2025-12-20']);
  });

  it.each(['31/02', '30/02/2026', 'dia 32', '31 de abril'])(
    'marca data inexistente "%s" como inválida',
    (texto) => {
      expect(datas(texto)).toEqual(['invalida']);
    },
  );

  it.each([
    'semana passada',
    'outro dia',
    'esses dias',
    'no fim de semana',
    'mês passado',
    'há poucos dias',
    'uns dias atrás',
  ])('marca "%s" como vaga', (texto) => {
    expect(datas(texto)).toEqual(['vaga']);
  });

  it('encontra mais de uma data, na ordem do texto', () => {
    expect(datas('foi ontem ou anteontem')).toEqual([
      '2026-10-12',
      '2026-10-11',
    ]);
  });

  it('não lê "dia 5 de outubro" também como "dia 5"', () => {
    expect(datas('no dia 5 de outubro')).toEqual(['2026-10-05']);
  });

  it('atravessa a virada do ano', () => {
    expect(datas('ontem', '2026-01-01')).toEqual(['2025-12-31']);
    expect(datas('29/02', '2026-03-10')).toEqual(['invalida']);
  });
});
