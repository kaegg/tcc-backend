import { extractPeriod } from './periods';
import { normalize } from './text';

// Quarta-feira.
const HOJE = '2026-10-14';
const ler = (texto: string, referencia = HOJE) =>
  extractPeriod(normalize(texto), referencia);

describe('extractPeriod', () => {
  it.each([
    ['quanto gastei este mês?', '2026-10-01', '2026-10-31'],
    ['resumo do mês', '2026-10-01', '2026-10-31'],
    ['quanto gastei no mês passado', '2026-09-01', '2026-09-30'],
    ['e no mês retrasado?', '2026-08-01', '2026-08-31'],
    ['gastos desta semana', '2026-10-12', '2026-10-18'],
    ['quanto gastei na semana passada', '2026-10-05', '2026-10-11'],
    ['saldo deste ano', '2026-01-01', '2026-12-31'],
    ['receitas do ano passado', '2025-01-01', '2025-12-31'],
    ['quanto gastei hoje', '2026-10-14', '2026-10-14'],
    ['e ontem?', '2026-10-13', '2026-10-13'],
    ['gastos de 05/10', '2026-10-05', '2026-10-05'],
    ['quanto gastei em setembro', '2026-09-01', '2026-09-30'],
    ['resumo de outubro', '2026-10-01', '2026-10-31'],
    ['despesas de março de 2025', '2025-03-01', '2025-03-31'],
    ['despesas de dezembro', '2025-12-01', '2025-12-31'],
    ['quanto recebi em 2025', '2025-01-01', '2025-12-31'],
    ['nos últimos 7 dias', '2026-10-08', '2026-10-14'],
    ['nas últimas duas semanas', '2026-10-01', '2026-10-14'],
    ['nos últimos 3 meses', '2026-08-01', '2026-10-31'],
    ['nos últimos três meses', '2026-08-01', '2026-10-31'],
    ['de 01/09 a 15/09', '2026-09-01', '2026-09-15'],
    ['de 1 a 15 de setembro', '2026-09-01', '2026-09-15'],
    ['entre 1 e 15 de setembro', '2026-09-01', '2026-09-15'],
    ['do dia 1 ao dia 10', '2026-10-01', '2026-10-10'],
    ['de setembro a outubro', '2026-09-01', '2026-10-31'],
    ['entre agosto e setembro', '2026-08-01', '2026-09-30'],
    ['desde setembro', '2026-09-01', '2026-10-14'],
    ['a partir de 01/10', '2026-10-01', '2026-10-14'],
  ])('"%s" → %s a %s', (texto, from, to) => {
    expect(ler(texto)).toEqual({ kind: 'resolvido', period: { from, to } });
  });

  it('na virada do ano, "mês passado" é dezembro do ano anterior', () => {
    expect(ler('mês passado', '2027-01-10')).toEqual({
      kind: 'resolvido',
      period: { from: '2026-12-01', to: '2026-12-31' },
    });
  });

  it('fevereiro bissexto termina no dia 29', () => {
    expect(ler('fevereiro de 2028')).toEqual({
      kind: 'resolvido',
      period: { from: '2028-02-01', to: '2028-02-29' },
    });
  });

  it.each(['quanto gastei?', 'qual meu saldo', 'gastei 2000 reais'])(
    'sem período: "%s"',
    (texto) => {
      expect(ler(texto)).toEqual({ kind: 'ausente' });
    },
  );

  it.each([
    'quanto gastei recentemente',
    'gastos desses dias',
    'no começo do mês',
    'no fim de semana',
    'nos últimos dias',
    'há uns dias',
  ])('período impreciso: "%s"', (texto) => {
    expect(ler(texto).kind).toBe('impreciso');
  });

  it('data que não existe', () => {
    expect(ler('gastos de 31/02')).toEqual({ kind: 'invalido' });
  });

  it('dois períodos sem ligação viram pergunta, nunca escolha', () => {
    expect(ler('quanto gastei em setembro e outubro')).toEqual({
      kind: 'multiplos',
      options: [
        { from: '2026-09-01', to: '2026-09-30' },
        { from: '2026-10-01', to: '2026-10-31' },
      ],
    });
  });

  it('o mesmo período dito duas vezes não é ambiguidade', () => {
    expect(ler('este mês, outubro')).toEqual({
      kind: 'resolvido',
      period: { from: '2026-10-01', to: '2026-10-31' },
    });
  });
});
