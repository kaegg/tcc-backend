import type { InterpretationContext } from '../interpretation/entities';
import {
  isComplete,
  missingFields,
  updateRegistration,
  type RegistrationState,
} from './registration';
import { composeRegistrationReply } from './registration-reply';
import { buildTransactionDraft } from './transaction-draft';

const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';
const TRANSPORTE = '0199a1b2-c3d4-7000-8000-00000000c002';
const OUTROS_DESPESA = '0199a1b2-c3d4-7000-8000-00000000c009';
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c101';
const OUTROS_RECEITA = '0199a1b2-c3d4-7000-8000-00000000c109';

const CONTEXTO: InterpretationContext = {
  referenceDate: '2026-10-13',
  referenceWeekday: 'terça-feira',
  categories: [
    { id: ALIMENTACAO, name: 'Alimentação', type: 'despesa' },
    { id: TRANSPORTE, name: 'Transporte', type: 'despesa' },
    { id: OUTROS_DESPESA, name: 'Outros', type: 'despesa' },
    { id: SALARIO, name: 'Salário', type: 'receita' },
    { id: OUTROS_RECEITA, name: 'Outros', type: 'receita' },
  ],
};

/** O que o modelo devolveria em `entities`. */
const modelo = (entidades: Record<string, unknown> = {}) => ({
  type: null,
  amount: null,
  category: null,
  description: null,
  periodStart: null,
  periodEnd: null,
  ...entidades,
});

const primeira = (mensagem: string, entidades?: Record<string, unknown>) =>
  updateRegistration(null, mensagem, modelo(entidades), CONTEXTO);

const responder = (
  estado: RegistrationState,
  mensagem: string,
  entidades: Record<string, unknown> | null = null,
) =>
  updateRegistration(
    estado,
    mensagem,
    entidades ? modelo(entidades) : null,
    CONTEXTO,
  );

const resposta = (estado: RegistrationState) =>
  composeRegistrationReply(estado, CONTEXTO);

describe('extração de uma mensagem completa (TCC-024)', () => {
  it('extrai tipo, valor, data, categoria e descrição', () => {
    const estado = primeira('Gastei 45 reais no mercado ontem', {
      type: 'despesa',
      amount: 45,
      category: 'Alimentação',
      description: 'Mercado',
    });

    expect(estado.entities).toMatchObject({
      type: 'despesa',
      amount: '45.00',
      date: '2026-10-12',
      category: { id: ALIMENTACAO, name: 'Alimentação' },
      description: 'Mercado',
    });
    expect(isComplete(estado)).toBe(true);
    expect(estado.defaults).toEqual([]);
  });

  it('usa o valor do texto, não o do modelo', () => {
    const estado = primeira('paguei 45,90 no mercado', {
      type: 'despesa',
      amount: 45,
      category: 'Alimentação',
    });

    expect(estado.entities.amount).toBe('45.90');
  });

  it('ignora valor que o modelo inventou e que não está na mensagem', () => {
    const estado = primeira('gastei no mercado', {
      type: 'despesa',
      amount: 50,
      category: 'Alimentação',
    });

    expect(estado.entities.amount).toBeNull();
    expect(missingFields(estado)).toEqual(['amount']);
  });

  it('usa a data do texto, mesmo quando o modelo calcularia outra', () => {
    const estado = primeira('gastei 30 no uber sexta passada', {
      type: 'despesa',
      category: 'Transporte',
      date: '2026-10-13',
    });

    expect(estado.entities.date).toBe('2026-10-09');
  });

  it('assume hoje sem data na mensagem, como o formulário, e marca isso', () => {
    const estado = primeira('gastei 30 no uber', {
      type: 'despesa',
      category: 'Transporte',
    });

    expect(estado.entities.date).toBe('2026-10-13');
    expect(estado.defaults).toEqual(['date']);
    expect(resposta(estado)).toContain('com data de hoje (13/10/2026)');
  });

  it('prefere o valor marcado como dinheiro à quantidade', () => {
    const estado = primeira('comprei 3 pães por 10 reais', {
      type: 'despesa',
      category: 'Alimentação',
    });

    expect(estado.entities.amount).toBe('10.00');
  });

  it('deduz o tipo pelo verbo quando o modelo não diz', () => {
    const estado = primeira('recebi 3.200', { category: 'Salário' });

    expect(estado.entities.type).toBe('receita');
    expect(estado.entities.amount).toBe('3200.00');
  });

  it('deduz o tipo pela categoria de nome único', () => {
    const estado = primeira('3200 de salário', { category: 'Salário' });

    expect(estado.entities.type).toBe('receita');
  });

  it('valida a categoria contra as existentes e o tipo', () => {
    expect(
      primeira('gastei 50', { type: 'despesa', category: 'Salário' }).entities
        .category,
    ).toBeNull();
    expect(
      primeira('gastei 50 em outros', { type: 'despesa', category: 'Outros' })
        .entities.category?.id,
    ).toBe(OUTROS_DESPESA);
  });

  it('acha a categoria escrita na mensagem sem o modelo', () => {
    const estado = primeira('gastei 50 com alimentacao', { type: 'despesa' });

    expect(estado.entities.category?.id).toBe(ALIMENTACAO);
  });

  it('não persiste campo inválido: o rascunho só sai completo e válido', () => {
    const incompleto = primeira('gastei no mercado', {
      type: 'despesa',
      category: 'Alimentação',
    });
    expect(buildTransactionDraft(incompleto)).toBeNull();

    const completo = primeira('gastei 45 no mercado ontem', {
      type: 'despesa',
      category: 'Alimentação',
      description: 'Mercado',
    });
    expect(buildTransactionDraft(completo)).toEqual({
      type: 'despesa',
      amount: '45.00',
      categoryId: ALIMENTACAO,
      date: '2026-10-12',
      description: 'Mercado',
    });
  });

  it('o rascunho reprova o que o formulário reprovaria', () => {
    const estado = primeira('gastei 45', {
      type: 'despesa',
      category: 'Alimentação',
    });
    estado.entities.amount = '0.00';

    expect(buildTransactionDraft(estado)).toBeNull();
  });
});

describe('ambiguidades: o sistema pergunta em vez de escolher (TCC-025)', () => {
  it('dois valores na mensagem', () => {
    const estado = primeira('gastei 30 no uber e 50 no mercado', {
      type: 'despesa',
      amount: 30,
      category: 'Transporte',
    });

    expect(estado.entities.amount).toBeNull();
    expect(estado.clarifications).toEqual([
      {
        field: 'amount',
        reason: 'multiplos_valores',
        options: ['30.00', '50.00'],
      },
    ]);
    expect(buildTransactionDraft(estado)).toBeNull();
    expect(resposta(estado)).toContain(
      'Encontrei mais de um valor (R$ 30,00 e R$ 50,00)',
    );
    expect(resposta(estado)).toContain('envie um por vez');
  });

  it('duas datas na mensagem', () => {
    const estado = primeira('gastei 50 ontem ou anteontem', {
      type: 'despesa',
      category: 'Alimentação',
    });

    expect(estado.clarifications[0]).toMatchObject({
      field: 'date',
      reason: 'multiplas_datas',
    });
    expect(estado.defaults).toEqual([]);
    expect(resposta(estado)).toContain('mais de uma data');
  });

  it('data vaga não vira hoje', () => {
    const estado = primeira('paguei 200 de aluguel semana passada', {
      type: 'despesa',
      category: 'Outros',
    });

    expect(estado.entities.date).toBeNull();
    expect(estado.clarifications[0].reason).toBe('data_imprecisa');
    expect(resposta(estado)).toContain('Em que dia foi?');
  });

  it('data inexistente', () => {
    const estado = primeira('gastei 50 dia 31/02', {
      type: 'despesa',
      category: 'Alimentação',
    });

    expect(estado.clarifications[0].reason).toBe('data_invalida');
  });

  it('verbo contradiz o tipo do modelo', () => {
    const estado = primeira('recebi 50 no mercado', {
      type: 'despesa',
      category: 'Alimentação',
    });

    expect(estado.entities.type).toBeNull();
    expect(estado.clarifications[0].reason).toBe('tipo_conflitante');
    expect(resposta(estado)).toContain(
      'receita (dinheiro que entrou) ou uma despesa',
    );
  });

  it('depois do conflito de tipo, a resposta decide e revalida a categoria', () => {
    const conflito = primeira('recebi 50 no mercado', {
      type: 'despesa',
      category: 'Alimentação',
    });

    const despesa = responder(conflito, 'despesa');
    expect(despesa.entities).toMatchObject({
      type: 'despesa',
      category: { id: ALIMENTACAO },
    });
    expect(isComplete(despesa)).toBe(true);

    const receita = responder(conflito, 'foi receita');
    expect(receita.entities.type).toBe('receita');
    expect(receita.entities.category).toBeNull();
    expect(missingFields(receita)).toEqual(['category']);
  });

  it('conflito continua em aberto quando a resposta não fala do tipo', () => {
    const conflito = primeira('recebi 50 no mercado', {
      type: 'despesa',
      category: 'Alimentação',
    });
    const estado = responder(conflito, 'ontem');

    expect(estado.entities.type).toBeNull();
    expect(estado.clarifications).toEqual([
      { field: 'type', reason: 'tipo_conflitante', options: [] },
    ]);
  });

  it('pergunta só o que falta, com as opções de categoria', () => {
    const estado = primeira('gastei 50', { type: 'despesa' });

    expect(missingFields(estado)).toEqual(['category']);
    expect(resposta(estado)).toBe(
      'Entendi até aqui: despesa de R$ 50,00, com data de hoje (13/10/2026). Em qual categoria? Opções de despesa: Alimentação, Transporte e Outros.',
    );
  });

  it('pergunta vários campos de uma vez quando faltam vários', () => {
    const estado = primeira('foi no mercado', {});

    expect(missingFields(estado)).toEqual(['type', 'amount', 'category']);
    expect(resposta(estado)).toContain(
      'preciso saber se foi receita ou despesa, o valor e a categoria',
    );
  });
});

describe('respostas seguintes completam o lançamento (TCC-025)', () => {
  const semValor = () =>
    primeira('gastei no mercado ontem', {
      type: 'despesa',
      category: 'Alimentação',
      description: 'Mercado',
    });

  it.each([
    ['45', '45.00'],
    ['R$ 45,90', '45.90'],
    ['foi 45,90', '45.90'],
    ['quarenta e cinco reais', '45.00'],
    ['45 reais e 50 centavos', '45.50'],
  ])('lê o valor na resposta "%s"', (mensagem, valor) => {
    const estado = responder(semValor(), mensagem);

    expect(estado.entities.amount).toBe(valor);
    expect(estado.entities.date).toBe('2026-10-12');
    expect(estado.entities.description).toBe('Mercado');
    expect(isComplete(estado)).toBe(true);
  });

  it('escolhe entre os valores oferecidos, por valor ou por posição', () => {
    const duvida = primeira('gastei 30 no uber e 50 no mercado', {
      type: 'despesa',
      category: 'Transporte',
    });

    expect(responder(duvida, '30').entities.amount).toBe('30.00');
    expect(responder(duvida, 'o primeiro').entities.amount).toBe('30.00');
    expect(responder(duvida, 'o segundo').entities.amount).toBe('50.00');
    expect(responder(duvida, 'o último').entities.amount).toBe('50.00');
    expect(responder(duvida, 'o maior').entities.amount).toBe('50.00');
    expect(responder(duvida, 'o de 50').clarifications).toEqual([]);
  });

  it('escolhe entre as datas oferecidas', () => {
    const duvida = primeira('gastei 50 ontem ou anteontem', {
      type: 'despesa',
      category: 'Alimentação',
    });

    expect(responder(duvida, 'anteontem').entities.date).toBe('2026-10-11');
    expect(responder(duvida, 'a segunda').entities.date).toBe('2026-10-11');
  });

  it('resolve a data vaga com a resposta', () => {
    const duvida = primeira('paguei 200 semana passada', {
      type: 'despesa',
      category: 'Outros',
    });
    const estado = responder(duvida, 'na quarta');

    expect(estado.entities.date).toBe('2026-10-07');
    expect(isComplete(estado)).toBe(true);
  });

  it.each([
    ['despesa', 'despesa'],
    ['foi um gasto', 'despesa'],
    ['receita', 'receita'],
    ['entrada', 'receita'],
  ])('lê o tipo na resposta "%s"', (mensagem, tipo) => {
    const duvida = primeira('50 no pix', {});
    expect(responder(duvida, mensagem).entities.type).toBe(tipo);
  });

  it('lê a categoria na resposta, sem acento e sem caixa', () => {
    const duvida = primeira('gastei 50', { type: 'despesa' });

    expect(responder(duvida, 'alimentacao').entities.category?.id).toBe(
      ALIMENTACAO,
    );
    expect(responder(duvida, 'TRANSPORTE').entities.category?.id).toBe(
      TRANSPORTE,
    );
  });

  it('a categoria repetida entre tipos usa o tipo já conhecido', () => {
    const duvida = primeira('recebi 50', {});

    expect(responder(duvida, 'outros').entities.category?.id).toBe(
      OUTROS_RECEITA,
    );
  });

  it('aceita correção de um campo já preenchido', () => {
    const completo = responder(semValor(), '45');

    expect(responder(completo, 'na verdade foi 60').entities.amount).toBe(
      '60.00',
    );
    expect(responder(completo, 'não, foi anteontem').entities.date).toBe(
      '2026-10-11',
    );
  });

  it('trocar o tipo descarta a categoria de outro tipo e volta a perguntá-la', () => {
    const completo = responder(semValor(), '45');
    const estado = responder(completo, 'na verdade foi receita');

    expect(estado.entities.type).toBe('receita');
    expect(estado.entities.category).toBeNull();
    expect(missingFields(estado)).toEqual(['category']);
  });

  it('a data assumida dá lugar à data dita depois', () => {
    const assumida = primeira('gastei 30 no uber', {
      type: 'despesa',
      category: 'Transporte',
    });
    const estado = responder(assumida, 'foi ontem');

    expect(estado.entities.date).toBe('2026-10-12');
    expect(estado.defaults).toEqual([]);
  });

  it('resposta que não diz nada mantém o estado e a pergunta', () => {
    const duvida = primeira('gastei 30 no uber e 50 no mercado', {
      type: 'despesa',
      category: 'Transporte',
    });
    const estado = responder(duvida, 'hmm');

    expect(estado).toEqual(duvida);
  });
});

describe('dicas depois de tentativas sem sucesso', () => {
  const duvida = primeira('gastei no mercado', {
    type: 'despesa',
    category: 'Alimentação',
  });

  it('dá exemplo na terceira tentativa e oferece o formulário depois', () => {
    expect(
      composeRegistrationReply(duvida, CONTEXTO, { amount: 1 }),
    ).not.toContain('Dica');
    expect(composeRegistrationReply(duvida, CONTEXTO, { amount: 2 })).toContain(
      'Dica: escreva só o número, como “45,90”',
    );
    expect(composeRegistrationReply(duvida, CONTEXTO, { amount: 4 })).toContain(
      'use o formulário em Lançamentos',
    );
  });
});
