import { BadRequestException, Logger } from '@nestjs/common';
import {
  CATEGORIA_INVALIDA,
  type CategoriesService,
} from '../categories/categories.service';
import { LlmError } from '../llm/llm.errors';
import type { ChatRequest, OllamaService } from '../llm/ollama.service';
import type { ReportsService } from '../reports/reports.service';
import type { TransactionsService } from '../transactions/transactions.service';
import {
  CANCELLED_REPLY,
  ChatService,
  EDITED_MESSAGE,
  NOTHING_TO_CANCEL_REPLY,
  REPLACED_NOTICE,
} from './chat.service';
import type { Interpretation } from './interpretation/interpretation';
import { HELP_REPLY } from './replies';

const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';
const TRANSPORTE = '0199a1b2-c3d4-7000-8000-00000000c002';
const SALARIO = '0199a1b2-c3d4-7000-8000-00000000c003';

const vazio = {
  type: null,
  amount: null,
  category: null,
  description: null,
  periodStart: null,
  periodEnd: null,
};

const saida = (
  intent: string,
  entities: Record<string, unknown> = {},
  reply = '',
) =>
  JSON.stringify({
    intent,
    entities: { ...vazio, ...entities },
    ambiguous: false,
    reply,
  });

/** Corta a saída em pedaços pequenos, como chega do Ollama. */
function* emPedacos(texto: string, tamanho = 7) {
  for (let i = 0; i < texto.length; i += tamanho) {
    yield texto.slice(i, i + tamanho);
  }
  return {};
}

async function consumir(gerador: AsyncGenerator<string, Interpretation>) {
  const pedacos: string[] = [];
  let passo = await gerador.next();
  while (!passo.done) {
    pedacos.push(passo.value);
    passo = await gerador.next();
  }
  return { pedacos, texto: pedacos.join(''), resultado: passo.value };
}

describe('ChatService', () => {
  let chatStream: jest.Mock;
  let create: jest.Mock;
  let overview: jest.Mock;
  let service: ChatService;
  let avisos: string[];
  const sinal = new AbortController().signal;

  beforeEach(() => {
    avisos = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((mensagem: unknown) => {
        avisos.push(String(mensagem));
      });
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    chatStream = jest.fn();
    const categories = {
      findAll: jest.fn().mockResolvedValue([
        { id: ALIMENTACAO, name: 'Alimentação', type: 'despesa' },
        { id: TRANSPORTE, name: 'Transporte', type: 'despesa' },
        { id: SALARIO, name: 'Salário', type: 'receita' },
      ]),
    };
    create = jest.fn((userId: string, dto: { amount: string }) =>
      Promise.resolve({ id: 't1', userId, amount: dto.amount }),
    );
    overview = jest.fn();
    service = new ChatService(
      { chatStream } as unknown as OllamaService,
      categories as unknown as CategoriesService,
      { create } as unknown as TransactionsService,
      { overview } as unknown as ReportsService,
    );
    service.now = () => new Date('2026-10-13T15:00:00Z');
  });

  afterEach(() => jest.restoreAllMocks());

  const modeloResponde = (texto: string) =>
    chatStream.mockReturnValueOnce(emPedacos(texto));
  const enviar = (mensagem: string, usuario = 'u1', conversa = 'c1') =>
    consumir(service.streamReply(usuario, conversa, mensagem, sinal));
  const pedido = (chamada: number) =>
    (chatStream.mock.calls[chamada] as [ChatRequest])[0];

  describe('chamada ao modelo', () => {
    it('pede saída estruturada, determinística, com a data e as categorias atuais', async () => {
      modeloResponde(saida('ajuda', {}, 'Oi!'));

      await enviar('oi');

      const enviado = pedido(0);
      expect(enviado.temperature).toBe(0);
      expect(enviado.signal).toBe(sinal);
      expect(enviado.format).toMatchObject({ type: 'object' });
      expect(enviado.messages[0].content).toContain('2026-10-13');
      expect(enviado.messages[0].content).toContain('Alimentação');
      expect(enviado.messages.at(-1)).toEqual({ role: 'user', content: 'oi' });
    });

    it('nenhum texto livre do modelo chega ao usuário (TCC-028)', async () => {
      modeloResponde(saida('ajuda', {}, 'Texto inventado pelo modelo.'));

      const { texto, resultado } = await enviar(
        'me explica como você funciona',
      );

      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(texto).toBe(HELP_REPLY);
      expect(resultado.kind).toBe('informacao');
    });

    it('rejeita saída fora do esquema sem registrar o conteúdo no log', async () => {
      modeloResponde('Registrei sua despesa de 4512 reais!');

      await expect(enviar('gastei 4512')).rejects.toMatchObject({
        kind: 'resposta_invalida',
      });
      expect(avisos.join('\n')).not.toContain('4512');
    });
  });

  describe('registro de lançamento', () => {
    it('não exibe o texto do modelo: a resposta é escrita a partir dos dados validados', async () => {
      modeloResponde(
        saida(
          'registrar_lancamento',
          { type: 'despesa', amount: 99, category: 'Alimentação' },
          'Registrei R$ 99!',
        ),
      );

      const { pedacos, texto, resultado } = await enviar(
        'gastei 45 no mercado ontem',
      );

      expect(pedacos).toHaveLength(1);
      expect(texto).not.toContain('99');
      expect(texto).toBe(
        'Entendi: despesa de R$ 45,00 em Alimentação, ontem (12/10/2026). Confira os dados no cartão: para registrar, toque em Confirmar ou responda “pode registrar”.',
      );
      expect(resultado.transactionDraft).toMatchObject({
        amount: '45.00',
        categoryId: ALIMENTACAO,
        date: '2026-10-12',
      });
    });

    it('pergunta o que falta e completa com a resposta curta sem chamar o modelo', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      const pergunta = await enviar('gastei no mercado');

      expect(pergunta.texto).toContain('Qual foi o valor?');
      expect(pergunta.resultado.transactionDraft).toBeNull();
      expect(service.pendingSummary('u1', 'c1')).toEqual({
        missing: ['valor'],
        ready: false,
        proposal: null,
      });

      const resposta = await enviar('45,90');

      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(resposta.resultado.transactionDraft).toMatchObject({
        amount: '45.90',
      });
      expect(service.pendingSummary('u1', 'c1')).toMatchObject({
        missing: [],
        ready: true,
        proposal: {
          type: 'despesa',
          amount: '45.90',
          categoryId: ALIMENTACAO,
          categoryName: 'Alimentação',
          date: '2026-10-13',
          dateDefaulted: true,
        },
      });
    });

    it('resolve a dúvida entre dois valores com a escolha do usuário', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          amount: 30,
          category: 'Transporte',
        }),
      );
      const pergunta = await enviar('gastei 30 no uber e 50 no mercado');
      expect(pergunta.resultado.clarifications).toHaveLength(1);
      expect(pergunta.resultado.transactionDraft).toBeNull();

      const resposta = await enviar('o primeiro');

      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(resposta.resultado.entities.amount).toBe('30.00');
      expect(resposta.resultado.transactionDraft).not.toBeNull();
    });

    it('mensagem longa no meio do preenchimento vai ao modelo e completa o lançamento', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 30 reais');

      modeloResponde(saida('registrar_lancamento', { category: 'Transporte' }));
      const { resultado } = await enviar(
        'foi no uber voltando do trabalho para casa',
      );

      expect(chatStream).toHaveBeenCalledTimes(2);
      expect(resultado.entities).toMatchObject({
        amount: '30.00',
        category: { id: TRANSPORTE },
      });
      expect(resultado.transactionDraft).not.toBeNull();
    });

    it('novo relato com valor depois de um lançamento completo o substitui', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei 45 no mercado');

      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Transporte',
        }),
      );
      const { texto, resultado } = await enviar(
        'gastei 30 no uber voltando para casa hoje cedo',
      );

      expect(texto.startsWith(REPLACED_NOTICE)).toBe(true);
      expect(resultado.entities).toMatchObject({
        amount: '30.00',
        category: { id: TRANSPORTE },
      });
    });

    it('corrige um lançamento completo sem substituí-lo', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei 45 no mercado ontem');

      const { texto, resultado } = await enviar('na verdade foi 60');

      expect(texto).not.toContain(REPLACED_NOTICE);
      expect(resultado.entities).toMatchObject({
        amount: '60.00',
        date: '2026-10-12',
      });
    });

    it('dá dica depois de respostas que não ajudam', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado');

      modeloResponde(saida('registrar_lancamento'));
      const primeira = await enviar('hmm');
      modeloResponde(saida('registrar_lancamento'));
      const segunda = await enviar('sei lá');

      expect(primeira.texto).not.toContain('Dica');
      expect(segunda.texto).toContain('Dica: escreva só o número');
    });
  });

  describe('cancelamento', () => {
    it('“cancelar” descarta o lançamento sem chamar o modelo', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 30');

      const { texto, resultado } = await enviar('deixa pra lá');

      expect(texto).toBe(CANCELLED_REPLY);
      expect(resultado.transactionDraft).toBeNull();
      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(service.pendingSummary('u1', 'c1')).toBeNull();
    });

    it('avisa quando não há o que cancelar', async () => {
      const { texto } = await enviar('cancela');

      expect(texto).toBe(NOTHING_TO_CANCEL_REPLY);
      expect(chatStream).not.toHaveBeenCalled();
    });

    it('conversa excluída leva o lançamento pendente, sem gravar', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 30');
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 50', 'u1', 'c2');

      service.forget('u1', 'c1');

      expect(service.pendingSummary('u1', 'c1')).toBeNull();
      expect(service.pendingSummary('u1', 'c2')).not.toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('cancela pelo botão da interface', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 30');

      expect(service.cancelPending('u1', 'c1')).toBe(CANCELLED_REPLY);
      expect(service.pendingSummary('u1', 'c1')).toBeNull();
      expect(service.cancelPending('u1', 'c1')).toBe(NOTHING_TO_CANCEL_REPLY);
    });

    it('depois de cancelar, um número solto não completa nada', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado');
      await enviar('cancela');

      modeloResponde(saida('ajuda', {}, 'Não entendi.'));
      await enviar('45');

      expect(chatStream).toHaveBeenCalledTimes(2);
      expect(service.pendingSummary('u1', 'c1')).toBeNull();
    });
  });

  describe('confirmação e edição (TCC-026)', () => {
    async function proposta(mensagem = 'gastei 45 no mercado ontem') {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
          description: 'Mercado',
        }),
      );
      await enviar(mensagem);
      const id = service.pendingSummary('u1', 'c1')?.proposal?.id;
      if (!id) throw new Error('sem proposta');
      return id;
    }

    const valores = (extra: Record<string, unknown> = {}) => ({
      type: 'despesa',
      amount: '60.00',
      categoryId: TRANSPORTE,
      date: '2026-10-10',
      description: 'Uber',
      ...extra,
    });

    it('grava pelo serviço do formulário, como assistente, o que o cartão mostra', async () => {
      const id = await proposta();

      const resultado = await service.confirmPending('u1', 'c1', id);

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          type: 'despesa',
          amount: '45.00',
          categoryId: ALIMENTACAO,
          date: '2026-10-12',
          description: 'Mercado',
        }),
        'assistente',
      );
      expect(resultado).toMatchObject({
        ok: true,
        reply:
          'Pronto, registrei: despesa de R$ 45,00 em Alimentação, ontem (12/10/2026), descrição “Mercado”. O lançamento já aparece em Lançamentos e nos relatórios.',
      });
      expect(service.pendingSummary('u1', 'c1')).toBeNull();
    });

    it('não grava sem lançamento pendente nem quando ele ainda está incompleto', async () => {
      expect(await service.confirmPending('u1', 'c1', 'x')).toEqual({
        ok: false,
        code: 'operacao_inexistente',
      });

      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei no mercado');
      expect(service.pendingSummary('u1', 'c1')?.proposal).toBeNull();

      expect(create).not.toHaveBeenCalled();
    });

    it('recusa a confirmação de uma versão que já mudou', async () => {
      const antiga = await proposta();
      await enviar('na verdade foi 60');

      const resultado = await service.confirmPending('u1', 'c1', antiga);

      expect(resultado).toEqual({ ok: false, code: 'operacao_alterada' });
      expect(create).not.toHaveBeenCalled();
      expect(service.pendingSummary('u1', 'c1')?.proposal?.amount).toBe(
        '60.00',
      );
    });

    it('dois cliques seguidos gravam uma vez só', async () => {
      const id = await proposta();

      const [primeiro, segundo] = await Promise.all([
        service.confirmPending('u1', 'c1', id),
        service.confirmPending('u1', 'c1', id),
      ]);

      expect(create).toHaveBeenCalledTimes(1);
      expect(primeiro.ok).toBe(true);
      expect(segundo).toEqual({ ok: false, code: 'operacao_inexistente' });
    });

    it('categoria desativada antes da confirmação: nada é gravado e a proposta continua', async () => {
      const id = await proposta();
      create.mockRejectedValueOnce(
        new BadRequestException({
          message: [CATEGORIA_INVALIDA],
          fieldErrors: { categoryId: [CATEGORIA_INVALIDA] },
        }),
      );

      const resultado = await service.confirmPending('u1', 'c1', id);

      expect(resultado).toEqual({
        ok: false,
        code: 'dados_invalidos',
        fieldErrors: { categoryId: [CATEGORIA_INVALIDA] },
      });
      expect(service.pendingSummary('u1', 'c1')?.proposal?.id).toBe(id);
    });

    it('“pode registrar” confirma por texto, sem chamar o modelo', async () => {
      await proposta();

      const { texto, resultado } = await enviar('Pode registrar!');

      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(texto).toMatch(/^Pronto, registrei: despesa de R\$ 45,00/);
      expect(resultado.outcome).toBe('registrado');
      expect(service.pendingSummary('u1', 'c1')).toBeNull();
    });

    it('“sim” com lançamento incompleto não grava', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado');

      modeloResponde(saida('registrar_lancamento'));
      const { resultado } = await enviar('sim');

      expect(create).not.toHaveBeenCalled();
      expect(resultado.outcome).toBeUndefined();
      expect(service.pendingSummary('u1', 'c1')?.missing).toEqual(['valor']);
    });

    it('“cancelar” por texto informa que o lançamento foi encerrado', async () => {
      await proposta();

      const { resultado } = await enviar('cancela');

      expect(resultado.outcome).toBe('cancelado');
      expect(create).not.toHaveBeenCalled();
    });

    it('a edição no cartão troca os dados, gera nova versão e não grava', async () => {
      const id = await proposta('gastei 45 no mercado');

      const resultado = await service.editPending('u1', 'c1', id, valores());

      expect(create).not.toHaveBeenCalled();
      expect(resultado.ok).toBe(true);
      const proposal = service.pendingSummary('u1', 'c1')?.proposal;
      expect(proposal).toEqual({
        id: expect.any(String) as string,
        type: 'despesa',
        amount: '60.00',
        categoryId: TRANSPORTE,
        categoryName: 'Transporte',
        date: '2026-10-10',
        description: 'Uber',
        dateDefaulted: false,
      });
      expect(proposal?.id).not.toBe(id);

      await service.confirmPending('u1', 'c1', proposal?.id ?? '');
      expect(create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ amount: '60.00', categoryId: TRANSPORTE }),
        'assistente',
      );
    });

    it('a edição entra no histórico do modelo', async () => {
      const id = await proposta();
      await service.editPending('u1', 'c1', id, valores());

      modeloResponde(saida('fora_do_escopo'));
      await enviar('qual a capital da França?');

      const historico = pedido(1).messages;
      expect(historico.at(-3)).toEqual({
        role: 'user',
        content: EDITED_MESSAGE,
      });
      expect(historico.at(-2)?.content).toContain('"amount":60');
    });

    it('a edição reprova com as mesmas mensagens do formulário', async () => {
      const id = await proposta();

      expect(
        await service.editPending(
          'u1',
          'c1',
          id,
          valores({ amount: '0', description: 'ab' }),
        ),
      ).toMatchObject({
        ok: false,
        code: 'dados_invalidos',
        fieldErrors: {
          amount: ['O valor deve ser maior que zero.'],
          description: ['Descreva o lançamento com pelo menos 3 caracteres.'],
        },
      });

      expect(
        await service.editPending(
          'u1',
          'c1',
          id,
          valores({ categoryId: SALARIO }),
        ),
      ).toEqual({
        ok: false,
        code: 'dados_invalidos',
        fieldErrors: { categoryId: [CATEGORIA_INVALIDA] },
      });

      expect(
        await service.editPending(
          'u1',
          'c1',
          id,
          valores({ source: 'formulario' }),
        ),
      ).toMatchObject({
        ok: false,
        fieldErrors: { source: [expect.any(String)] },
      });

      expect(service.pendingSummary('u1', 'c1')?.proposal?.id).toBe(id);
    });

    it('recusa editar uma versão que já mudou', async () => {
      const antiga = await proposta();
      await enviar('na verdade foi 60');

      expect(await service.editPending('u1', 'c1', antiga, valores())).toEqual({
        ok: false,
        code: 'operacao_alterada',
      });
    });
  });

  describe('consulta de relatórios (TCC-027)', () => {
    // `service.now` é 13/10/2026 (terça-feira) em São Paulo.
    const categoria = (
      categoryId: string,
      categoryName: string,
      total: string,
      transactionCount: number,
      share: string,
    ) => ({ categoryId, categoryName, total, transactionCount, share });

    const relatorio = (extra: Record<string, unknown> = {}) => ({
      from: '2026-10-01',
      to: '2026-10-31',
      income: '3000.00',
      expense: '350.00',
      balance: '2650.00',
      savingsRate: '88.33',
      transactionCount: 4,
      incomeByCategory: [categoria(SALARIO, 'Salário', '3000.00', 1, '100.00')],
      expenseByCategory: [
        categoria(ALIMENTACAO, 'Alimentação', '230.00', 2, '65.71'),
        categoria(TRANSPORTE, 'Transporte', '120.00', 1, '34.29'),
      ],
      months: [],
      ...extra,
    });

    const consulta = (
      entidades: Record<string, unknown> = {},
      intencao = 'consultar_relatorio',
    ) => modeloResponde(saida(intencao, entidades, 'Você gastou R$ 9.999!'));

    it('responde com os números do serviço de relatórios, nunca com os do modelo', async () => {
      overview.mockResolvedValueOnce(relatorio());
      consulta({ type: 'despesa' });

      const { texto, resultado } = await enviar('quanto gastei este mês?');

      expect(overview).toHaveBeenCalledWith('u1', {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(texto).not.toContain('9.999');
      expect(texto).toBe(
        'Em outubro de 2026 (01/10/2026 a 31/10/2026), suas despesas somaram R$ 350,00, em 3 lançamentos. Por categoria: Alimentação (R$ 230,00; 65,71%) e Transporte (R$ 120,00; 34,29%).',
      );
      expect(resultado.report).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });

    it('o período vem do texto, mesmo quando o modelo sugere outro', async () => {
      overview.mockResolvedValueOnce(
        relatorio({ from: '2026-09-01', to: '2026-09-30' }),
      );
      consulta({ type: 'despesa', periodStart: '2026-10-01' });

      await enviar('quanto gastei no mês passado?');

      expect(overview).toHaveBeenCalledWith('u1', {
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });

    it('sem período, pergunta; a resposta curta conclui sem chamar o modelo', async () => {
      consulta({ type: 'despesa' });
      const pergunta = await enviar('quanto gastei?');

      expect(pergunta.texto).toMatch(/^De qual período\?/);
      expect(pergunta.resultado.missingFields).toEqual([
        'periodStart',
        'periodEnd',
      ]);
      expect(overview).not.toHaveBeenCalled();

      overview.mockResolvedValueOnce(
        relatorio({ from: '2026-09-01', to: '2026-09-30' }),
      );
      const resposta = await enviar('mês passado');

      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(overview).toHaveBeenCalledWith('u1', {
        from: '2026-09-01',
        to: '2026-09-30',
      });
      expect(resposta.texto).toMatch(
        /^Em setembro de 2026 \(01\/09\/2026 a 30\/09\/2026\), suas despesas somaram/,
      );
    });

    it('período impreciso ou com duas leituras gera pergunta, nunca escolha', async () => {
      consulta({ type: 'despesa' });
      const vago = await enviar('quanto gastei recentemente?');
      expect(vago.texto).toMatch(/^Não consegui saber o período exato/);

      consulta({ type: 'despesa' });
      const dois = await enviar('quanto gastei em agosto e setembro?');
      expect(dois.texto).toContain(
        'agosto de 2026 (01/08/2026 a 31/08/2026) e setembro de 2026 (01/09/2026 a 30/09/2026)',
      );

      expect(overview).not.toHaveBeenCalled();
    });

    it('recusa período maior que o da tela de relatórios, com a mesma mensagem', async () => {
      consulta();

      const { texto } = await enviar('resumo de 01/01/2020 a 31/12/2026');

      expect(texto).toContain('O período deve ter no máximo 24 meses.');
      expect(overview).not.toHaveBeenCalled();
    });

    it('consulta por categoria', async () => {
      overview.mockResolvedValueOnce(relatorio());
      consulta({ category: 'Transporte' });

      const { texto } = await enviar('quanto gastei com uber este mês?');

      expect(texto).toBe(
        'Em outubro de 2026 (01/10/2026 a 31/10/2026), você gastou R$ 120,00 em Transporte, em 1 lançamento — 34,29% das despesas do período.',
      );
    });

    it('saldo e quanto sobrou das receitas', async () => {
      overview.mockResolvedValueOnce(relatorio());
      consulta();

      const { texto } = await enviar('quanto economizei este mês?');

      expect(texto).toBe(
        'Em outubro de 2026 (01/10/2026 a 31/10/2026), suas receitas somaram R$ 3.000,00 e suas despesas, R$ 350,00. O saldo ficou positivo em R$ 2.650,00, o equivalente a 88,33% das receitas.',
      );
    });

    it('saldo negativo', async () => {
      overview.mockResolvedValueOnce(
        relatorio({
          income: '100.00',
          balance: '-250.00',
          savingsRate: '-250.00',
        }),
      );
      consulta();

      const { texto } = await enviar('qual meu saldo este mês?');

      expect(texto).toContain(
        'O saldo ficou negativo em R$ 250,00: as despesas superaram as receitas.',
      );
    });

    it('resumo do mês', async () => {
      overview.mockResolvedValueOnce(relatorio());
      consulta({}, 'obter_resumo');

      const { texto } = await enviar('me mostra o resumo do mês');

      expect(texto).toBe(
        'Em outubro de 2026 (01/10/2026 a 31/10/2026): receitas de R$ 3.000,00, despesas de R$ 350,00 e saldo de R$ 2.650,00, em 4 lançamentos. Maiores despesas: Alimentação (R$ 230,00; 65,71%) e Transporte (R$ 120,00; 34,29%).',
      );
    });

    it('período sem lançamentos', async () => {
      overview.mockResolvedValueOnce(
        relatorio({
          from: '2026-10-13',
          to: '2026-10-13',
          transactionCount: 0,
          income: '0.00',
          expense: '0.00',
          balance: '0.00',
          incomeByCategory: [],
          expenseByCategory: [],
        }),
      );
      consulta();

      const { texto } = await enviar('resumo de hoje');

      expect(texto).toBe('Hoje (13/10/2026), não há lançamentos registrados.');
    });

    it('consulta no meio de um lançamento: responde e lembra dele', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado');

      overview.mockResolvedValueOnce(relatorio());
      consulta({ type: 'despesa' });
      const { texto } = await enviar('quanto gastei este mês?');

      expect(texto).toContain('suas despesas somaram R$ 350,00');
      expect(texto).toContain(
        'Lembrete: o lançamento em andamento ainda precisa de valor',
      );
      expect(service.pendingSummary('u1', 'c1')?.missing).toEqual(['valor']);
    });

    it('outra intenção descarta a consulta que esperava o período', async () => {
      consulta({ type: 'despesa' });
      await enviar('quanto gastei?');

      modeloResponde(saida('ajuda', {}, 'Oi!'));
      await enviar('oi');

      modeloResponde(saida('ajuda', {}, 'Não entendi.'));
      await enviar('setembro');

      expect(overview).not.toHaveBeenCalled();
      expect(chatStream).toHaveBeenCalledTimes(3);
    });
  });

  describe('respostas padronizadas (TCC-028)', () => {
    it('“ajuda” responde com exemplos de despesa, receita e relatório, sem o modelo', async () => {
      const { texto, resultado } = await enviar('Ajuda!');

      expect(chatStream).not.toHaveBeenCalled();
      expect(texto).toBe(HELP_REPLY);
      expect(texto).toMatch(/Despesa: /);
      expect(texto).toMatch(/Receita: /);
      expect(texto).toMatch(/Relatório: /);
      expect(resultado.kind).toBe('informacao');
    });

    it('os exemplos da ajuda funcionam de verdade', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'receita' }));
      const receita = await enviar('recebi 3.000 de salário dia 5');

      expect(receita.resultado.transactionDraft).toMatchObject({
        type: 'receita',
        amount: '3000.00',
        categoryId: SALARIO,
        date: '2026-10-05',
      });
    });

    it('a ajuda no meio de um lançamento lembra dele', async () => {
      modeloResponde(saida('registrar_lancamento', { type: 'despesa' }));
      await enviar('gastei 30 reais');

      const { texto } = await enviar('ajuda');

      expect(texto.startsWith(HELP_REPLY)).toBe(true);
      expect(texto).toContain('Lembrete: o lançamento em andamento');
    });

    it.each([
      'devo investir meu saldo em CDB?',
      'vale a pena fazer um financiamento?',
      'me recomenda onde aplicar meu dinheiro',
    ])('recusa aconselhamento financeiro: "%s"', async (pergunta) => {
      modeloResponde(
        saida('fora_do_escopo', {}, 'Invista tudo em ações da empresa X!'),
      );

      const { texto } = await enviar(pergunta);

      expect(texto).not.toContain('Invista');
      expect(texto).toMatch(
        /^Não dou recomendações de investimento nem aconselhamento financeiro profissional/,
      );
    });

    it('outro assunto: diz o que o assistente faz e como ver exemplos', async () => {
      modeloResponde(saida('fora_do_escopo', {}, 'Paris.'));

      const { texto } = await enviar('qual a capital da França?');

      expect(texto).toBe(
        'Só consigo ajudar com seus lançamentos e relatórios no IntelliFinance. Por exemplo: “gastei 30 no uber hoje” ou “quanto gastei este mês?”. Para ver mais exemplos, escreva “ajuda”.',
      );
    });

    it('classifica cada resposta: pergunta, confirmação pendente, sucesso, erro', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      const pergunta = await enviar('gastei no mercado');
      expect(pergunta.resultado.kind).toBe('pergunta');

      const confirmacao = await enviar('45');
      expect(confirmacao.resultado.kind).toBe('confirmacao');

      const sucesso = await enviar('pode registrar');
      expect(sucesso.resultado.kind).toBe('sucesso');

      modeloResponde(saida('consultar_relatorio'));
      const erro = await enviar('quanto gastei em 31/02?');
      expect(erro.resultado.kind).toBe('erro');

      const cancelado = await enviar('cancela');
      expect(cancelado.resultado.kind).toBe('informacao');
    });
  });

  describe('mudança de assunto', () => {
    it('responde a outra pergunta e lembra do lançamento em andamento', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado');

      modeloResponde(saida('fora_do_escopo'));
      const { texto } = await enviar('qual a previsão do tempo?');

      expect(texto).toContain('Só consigo ajudar com seus lançamentos');
      expect(texto).toContain(
        'Lembrete: o lançamento em andamento ainda precisa de valor',
      );
      expect(service.pendingSummary('u1', 'c1')?.missing).toEqual(['valor']);
    });
  });

  describe('histórico e isolamento', () => {
    it('guarda no histórico a resposta escrita pelo backend, no formato do modelo', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei 45 no mercado');

      modeloResponde(saida('ajuda', {}, 'Ok.'));
      await enviar('obrigado, como funciona o resumo?');

      const assistente = pedido(1).messages[2];
      expect(assistente.role).toBe('assistant');
      const fala = JSON.parse(assistente.content) as Record<string, unknown>;
      expect(fala.reply).toContain('Entendi: despesa de R$ 45,00');
      expect(fala.entities).not.toHaveProperty('date');
    });

    it('não guarda no histórico resposta interrompida ou rejeitada', async () => {
      chatStream.mockReturnValueOnce(
        (function* () {
          yield '{"intent":"ajuda","reply":"me';
          throw new LlmError('tempo_esgotado');
        })(),
      );
      await expect(enviar('oi')).rejects.toBeInstanceOf(LlmError);

      modeloResponde('lixo');
      await expect(enviar('de novo')).rejects.toBeInstanceOf(LlmError);

      modeloResponde(saida('ajuda', {}, 'Ok.'));
      await enviar('terceira');

      expect(pedido(2).messages.slice(1)).toEqual([
        { role: 'user', content: 'terceira' },
      ]);
    });

    it('não mistura lançamentos de usuários ou conversas diferentes', async () => {
      modeloResponde(
        saida('registrar_lancamento', {
          type: 'despesa',
          category: 'Alimentação',
        }),
      );
      await enviar('gastei no mercado', 'u1', 'c1');

      expect(service.pendingSummary('u2', 'c1')).toBeNull();
      expect(service.pendingSummary('u1', 'c2')).toBeNull();

      modeloResponde(saida('ajuda', {}, 'Oi.'));
      await enviar('45', 'u2', 'c1');
      expect(service.pendingSummary('u1', 'c1')?.missing).toEqual(['valor']);
    });
  });
});
