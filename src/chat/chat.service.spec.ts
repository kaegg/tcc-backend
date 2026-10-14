import { LlmError } from '../llm/llm.errors';
import type { ChatRequest, OllamaService } from '../llm/ollama.service';
import { ChatService, SYSTEM_PROMPT } from './chat.service';

function* gerar(...pedacos: string[]) {
  for (const pedaco of pedacos) yield pedaco;
  return {};
}

function* falhar() {
  yield 'meia';
  throw new LlmError('tempo_esgotado');
}

async function coletar(gerador: AsyncGenerator<string>) {
  const pedacos: string[] = [];
  for await (const pedaco of gerador) pedacos.push(pedaco);
  return pedacos;
}

describe('ChatService', () => {
  let chatStream: jest.Mock;
  let service: ChatService;
  const sinal = new AbortController().signal;

  beforeEach(() => {
    chatStream = jest.fn();
    service = new ChatService({ chatStream } as unknown as OllamaService);
  });

  const enviado = (chamada: number) =>
    (chatStream.mock.calls[chamada] as [ChatRequest])[0];

  it('repassa os pedaços com a instrução de sistema e o sinal de cancelamento', async () => {
    chatStream.mockReturnValue(gerar('Olá', '!'));

    expect(await coletar(service.streamReply('u1', 'c1', 'oi', sinal))).toEqual(
      ['Olá', '!'],
    );
    expect(enviado(0).messages).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'oi' },
    ]);
    expect(enviado(0).signal).toBe(sinal);
  });

  it('envia o histórico da conversa na mensagem seguinte', async () => {
    chatStream.mockReturnValueOnce(gerar('Olá!'));
    await coletar(service.streamReply('u1', 'c1', 'oi', sinal));

    chatStream.mockReturnValueOnce(gerar('Tudo.'));
    await coletar(service.streamReply('u1', 'c1', 'tudo bem?', sinal));

    expect(enviado(1).messages.slice(1)).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá!' },
      { role: 'user', content: 'tudo bem?' },
    ]);
  });

  it('não guarda no histórico uma resposta interrompida', async () => {
    chatStream.mockReturnValueOnce(falhar());
    await expect(
      coletar(service.streamReply('u1', 'c1', 'oi', sinal)),
    ).rejects.toBeInstanceOf(LlmError);

    chatStream.mockReturnValueOnce(gerar('ok'));
    await coletar(service.streamReply('u1', 'c1', 'de novo', sinal));

    expect(enviado(1).messages.slice(1)).toEqual([
      { role: 'user', content: 'de novo' },
    ]);
  });

  it('não mistura conversas de usuários diferentes', async () => {
    chatStream.mockReturnValueOnce(gerar('segredo'));
    await coletar(service.streamReply('u1', 'c1', 'meu saldo', sinal));

    chatStream.mockReturnValueOnce(gerar('ok'));
    await coletar(service.streamReply('u2', 'c1', 'oi', sinal));

    expect(enviado(1).messages.slice(1)).toEqual([
      { role: 'user', content: 'oi' },
    ]);
  });
});
