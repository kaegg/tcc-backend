import {
  MAX_MESSAGE_CHARS,
  parseCancel,
  parseSendMessage,
} from './chat.protocol';

describe('parseSendMessage', () => {
  const valido = { id: 'm1', conversationId: 'c1', content: '  oi  ' };

  it('aceita e apara o conteúdo', () => {
    expect(parseSendMessage(valido)).toEqual({
      id: 'm1',
      conversationId: 'c1',
      content: 'oi',
    });
  });

  it('ignora campos extras', () => {
    expect(
      parseSendMessage({ ...valido, role: 'assistant', history: [] }),
    ).toEqual({ id: 'm1', conversationId: 'c1', content: 'oi' });
  });

  it.each([
    ['nulo', null],
    ['texto', 'oi'],
    ['sem conteúdo', { ...valido, content: '   ' }],
    [
      'conteúdo longo',
      { ...valido, content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) },
    ],
    ['conteúdo não textual', { ...valido, content: 42 }],
    ['id com caracteres estranhos', { ...valido, id: '../x' }],
    ['id longo', { ...valido, id: 'a'.repeat(65) }],
    ['conversa ausente', { id: 'm1', content: 'oi' }],
  ])('recusa %s', (_caso, payload) => {
    expect(parseSendMessage(payload)).toBeNull();
  });
});

describe('parseCancel', () => {
  it('lê o id', () => {
    expect(parseCancel({ id: 'm1' })).toBe('m1');
  });

  it.each([null, {}, { id: 1 }, { id: 'a b' }])('recusa %p', (payload) => {
    expect(parseCancel(payload)).toBeNull();
  });
});
