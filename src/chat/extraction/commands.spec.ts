import {
  isCancelCommand,
  isConfirmCommand,
  isHelpCommand,
  isShortAnswer,
  looksLikeQuestion,
} from './commands';
import { normalize } from './text';
import { detectTypeHint, readTypeAnswer } from './type-hint';

const n = normalize;

describe('isCancelCommand', () => {
  it.each([
    'cancelar',
    'Cancela',
    'cancela isso',
    'cancela por favor!',
    'deixa pra lá',
    'deixa para lá',
    'esquece',
    'não quero mais',
    'desisto',
    'não, cancela',
    'ok cancela tudo',
    'para',
    'não precisa mais',
  ])('reconhece "%s"', (texto) => {
    expect(isCancelCommand(n(texto))).toBe(true);
  });

  it.each([
    'cancela a assinatura da netflix de 55 reais',
    'paguei o cancelamento',
    'gastei 50 para o almoço',
    'não',
    'nada de mais, foi 45',
  ])('não confunde com comando: "%s"', (texto) => {
    expect(isCancelCommand(n(texto))).toBe(false);
  });
});

describe('isHelpCommand', () => {
  it.each([
    'ajuda',
    'Ajuda!',
    'me ajuda',
    'exemplos',
    'o que você faz?',
    'o que vc sabe fazer',
    'como funciona?',
    'oi, ajuda por favor',
  ])('reconhece "%s"', (texto) => {
    expect(isHelpCommand(n(texto))).toBe(true);
  });

  it.each([
    'me ajuda a registrar 50 no mercado',
    'quanto gastei este mês?',
    'oi',
  ])('não confunde com ajuda: "%s"', (texto) => {
    expect(isHelpCommand(n(texto))).toBe(false);
  });
});

describe('isConfirmCommand', () => {
  it.each([
    'confirmo',
    'Confirmar',
    'pode registrar',
    'Pode lançar!',
    'sim',
    'sim, pode registrar',
    'ok, confirma',
    'isso mesmo',
    'está certo',
    'registra por favor',
    'pode salvar o lançamento',
  ])('reconhece "%s"', (texto) => {
    expect(isConfirmCommand(n(texto))).toBe(true);
  });

  it.each([
    'registra 50 no mercado',
    'registrar outra despesa',
    'não registra',
    'não',
    'isso',
    'sim, mas foi 60',
    'pode ser no cartão',
  ])('não confunde com confirmação: "%s"', (texto) => {
    expect(isConfirmCommand(n(texto))).toBe(false);
  });
});

describe('looksLikeQuestion', () => {
  it.each(['qual é o meu saldo?', 'quanto gastei este mês', 'como funciona'])(
    'reconhece pergunta "%s"',
    (texto) => {
      expect(looksLikeQuestion(n(texto))).toBe(true);
    },
  );

  it.each(['45', 'ontem', 'foi alimentação'])(
    'não confunde resposta "%s"',
    (texto) => {
      expect(looksLikeQuestion(n(texto))).toBe(false);
    },
  );
});

describe('isShortAnswer', () => {
  it('separa resposta curta de relato longo', () => {
    expect(isShortAnswer(n('foi 45,90'))).toBe(true);
    expect(
      isShortAnswer(n('na verdade foi no uber voltando do trabalho ontem')),
    ).toBe(false);
  });
});

describe('detectTypeHint', () => {
  it.each([
    ['gastei 50', 'despesa'],
    ['paguei a luz', 'despesa'],
    ['comprei pão', 'despesa'],
    ['recebi o salário', 'receita'],
    ['ganhei 100', 'receita'],
    ['me pagaram o freela', 'receita'],
    ['vendi a bicicleta', 'receita'],
    ['caiu na conta', 'receita'],
  ])('"%s" indica %s', (texto, tipo) => {
    expect(detectTypeHint(n(texto))).toBe(tipo);
  });

  it('não decide quando há sinais dos dois lados ou nenhum', () => {
    expect(detectTypeHint(n('recebi 100 e paguei 50'))).toBeNull();
    expect(detectTypeHint(n('50 no mercado'))).toBeNull();
  });
});

describe('readTypeAnswer', () => {
  it.each([
    ['despesa', 'despesa'],
    ['foi um gasto', 'despesa'],
    ['saída', 'despesa'],
    ['receita', 'receita'],
    ['entrada', 'receita'],
    ['talvez', null],
  ])('"%s" responde %s', (texto, tipo) => {
    expect(readTypeAnswer(n(texto))).toBe(tipo);
  });
});
