import { Logger } from '@nestjs/common';
import type { CategoriesService } from '../categories/categories.service';
import { LlmError } from '../llm/llm.errors';
import type { ChatRequest, OllamaService } from '../llm/ollama.service';
import { ChatService } from './chat.service';

const ALIMENTACAO = '0199a1b2-c3d4-7000-8000-00000000c001';

const vazio = {
  type: null,
  amount: null,
  date: null,
  category: null,
  description: null,
  periodStart: null,
  periodEnd: null,
};

const json = (reply: string, entities: Record<string, unknown> = {}) =>
  JSON.stringify({
    intent: 'registrar_lancamento',
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

async function consumir(gerador: AsyncGenerator<string, unknown>) {
  const pedacos: string[] = [];
  let passo = await gerador.next();
  while (!passo.done) {
    pedacos.push(passo.value);
    passo = await gerador.next();
  }
  return { pedacos, resultado: passo.value };
}

describe('ChatService', () => {
  let chatStream: jest.Mock;
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
      findAll: jest
        .fn()
        .mockResolvedValue([
          { id: ALIMENTACAO, name: 'Alimentação', type: 'despesa' },
        ]),
    };
    service = new ChatService(
      { chatStream } as unknown as OllamaService,
      categories as unknown as CategoriesService,
    );
    service.now = () => new Date('2026-10-13T15:00:00Z');
  });

  afterEach(() => jest.restoreAllMocks());

  const enviado = (chamada: number) =>
    (chatStream.mock.calls[chamada] as [ChatRequest])[0];

  it('pede saída estruturada, determinística, com a data e as categorias atuais', async () => {
    chatStream.mockReturnValue(emPedacos(json('Ok.')));

    await consumir(service.streamReply('u1', 'c1', 'oi', sinal));

    const pedido = enviado(0);
    expect(pedido.temperature).toBe(0);
    expect(pedido.signal).toBe(sinal);
    expect(pedido.format).toMatchObject({ type: 'object' });
    expect(pedido.messages[0].role).toBe('system');
    expect(pedido.messages[0].content).toContain('2026-10-13');
    expect(pedido.messages[0].content).toContain('Alimentação');
    expect(pedido.messages.at(-1)).toEqual({ role: 'user', content: 'oi' });
  });

  it('entrega só o texto da resposta, progressivamente, e devolve a interpretação', async () => {
    chatStream.mockReturnValue(
      emPedacos(
        json('Anotei uma despesa de R$ 45 em Alimentação.', {
          type: 'despesa',
          amount: 45,
          category: 'Alimentação',
        }),
      ),
    );

    const { pedacos, resultado } = await consumir(
      service.streamReply('u1', 'c1', 'gastei 45 no mercado', sinal),
    );

    expect(pedacos.length).toBeGreaterThan(1);
    expect(pedacos.join('')).toBe(
      'Anotei uma despesa de R$ 45 em Alimentação.',
    );
    expect(pedacos.join('')).not.toContain('intent');
    expect(resultado).toMatchObject({
      intent: 'registrar_lancamento',
      entities: { amount: '45.00', category: { id: ALIMENTACAO } },
      missingFields: [],
    });
  });

  it('entrega a resposta padrão quando o modelo não escreve texto', async () => {
    chatStream.mockReturnValue(emPedacos(json('')));

    const { pedacos } = await consumir(
      service.streamReply('u1', 'c1', 'oi', sinal),
    );

    expect(pedacos.join('')).toBe(
      'Entendi que você quer registrar um lançamento.',
    );
  });

  it('rejeita saída fora do esquema sem registrar o conteúdo no log', async () => {
    chatStream.mockReturnValue(
      emPedacos('Registrei sua despesa de 4512 reais!'),
    );

    await expect(
      consumir(service.streamReply('u1', 'c1', 'gastei 4512', sinal)),
    ).rejects.toMatchObject({ kind: 'resposta_invalida' });
    expect(avisos.join('\n')).not.toContain('4512');
  });

  it('guarda no histórico a interpretação validada, e não a saída crua', async () => {
    chatStream.mockReturnValueOnce(
      emPedacos(
        json('Ok.', { type: 'despesa', amount: -3, category: 'Viagem' }),
      ),
    );
    await consumir(service.streamReply('u1', 'c1', 'primeira', sinal));

    chatStream.mockReturnValueOnce(emPedacos(json('Ok.')));
    await consumir(service.streamReply('u1', 'c1', 'segunda', sinal));

    const historico = enviado(1).messages.slice(1, -1);
    expect(historico[0]).toEqual({ role: 'user', content: 'primeira' });
    expect(historico[1].role).toBe('assistant');
    expect(JSON.parse(historico[1].content)).toMatchObject({
      entities: { type: 'despesa', amount: null, category: null },
    });
  });

  it('não guarda no histórico resposta interrompida ou rejeitada', async () => {
    chatStream.mockReturnValueOnce(
      (function* () {
        yield '{"intent":"ajuda","reply":"me';
        throw new LlmError('tempo_esgotado');
      })(),
    );
    await expect(
      consumir(service.streamReply('u1', 'c1', 'oi', sinal)),
    ).rejects.toBeInstanceOf(LlmError);

    chatStream.mockReturnValueOnce(emPedacos('lixo'));
    await expect(
      consumir(service.streamReply('u1', 'c1', 'de novo', sinal)),
    ).rejects.toBeInstanceOf(LlmError);

    chatStream.mockReturnValueOnce(emPedacos(json('Ok.')));
    await consumir(service.streamReply('u1', 'c1', 'terceira', sinal));

    expect(enviado(2).messages.slice(1)).toEqual([
      { role: 'user', content: 'terceira' },
    ]);
  });

  it('não mistura conversas de usuários diferentes', async () => {
    chatStream.mockReturnValueOnce(emPedacos(json('Ok.')));
    await consumir(service.streamReply('u1', 'c1', 'meu saldo', sinal));

    chatStream.mockReturnValueOnce(emPedacos(json('Ok.')));
    await consumir(service.streamReply('u2', 'c1', 'oi', sinal));

    expect(enviado(1).messages.slice(1)).toEqual([
      { role: 'user', content: 'oi' },
    ]);
  });
});
