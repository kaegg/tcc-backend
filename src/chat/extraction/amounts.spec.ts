import { centsToAmount, extractAmounts } from './amounts';
import { normalize } from './text';

const valores = (texto: string) =>
  extractAmounts(normalize(texto)).map(
    (item) => `${centsToAmount(item.cents)}${item.marked ? '*' : ''}`,
  );

describe('extractAmounts', () => {
  it.each([
    ['45', '45.00'],
    ['45,9', '45.90'],
    ['45,90', '45.90'],
    ['120.50', '120.50'],
    ['120.5', '120.50'],
    ['1.234', '1234.00'],
    ['1.234,56', '1234.56'],
    ['1234,56', '1234.56'],
    ['3.200', '3200.00'],
    ['2 mil', '2000.00'],
    ['1,5 mil', '1500.00'],
    ['2k', '2000.00'],
    ['1,5k', '1500.00'],
  ])('lê "%s"', (texto, esperado) => {
    expect(valores(`paguei ${texto}`)).toEqual([esperado]);
  });

  it.each([
    ['R$ 45', '45.00*'],
    ['R$45,90', '45.90*'],
    ['45 reais', '45.00*'],
    ['1 real', '1.00*'],
    ['50 conto', '50.00*'],
    ['50 centavos', '0.50*'],
    ['45 reais e 50 centavos', '45.50*'],
  ])('marca dinheiro em "%s"', (texto, esperado) => {
    expect(valores(texto)).toEqual([esperado]);
  });

  it.each([
    ['cinquenta reais', '50.00*'],
    ['quarenta e cinco', '45.00'],
    ['mil e duzentos', '1200.00'],
    ['dois mil e quinhentos reais', '2500.00*'],
    ['cento e vinte e três', '123.00'],
    ['quarenta e cinco reais e cinquenta centavos', '45.50*'],
    ['um real', '1.00*'],
    ['um milhão', '1000000.00'],
  ])('lê número por extenso "%s"', (texto, esperado) => {
    expect(valores(texto)).toEqual([esperado]);
  });

  it.each([
    'comprei um negócio',
    'paguei uma conta',
    'gastei 10% do salário',
    'em 3x no cartão',
    'fiquei 2 horas',
    'andei 5 km',
    'às 10',
    'parcela 3',
    'no mês 10',
    'apartamento 302',
  ])('não lê como dinheiro: "%s"', (texto) => {
    expect(valores(texto)).toEqual([]);
  });

  it('lê todos os valores, na ordem', () => {
    expect(valores('30 no uber e R$ 50 no mercado')).toEqual([
      '30.00',
      '50.00*',
    ]);
  });
});
