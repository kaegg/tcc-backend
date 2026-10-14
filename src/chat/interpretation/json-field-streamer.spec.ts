import { JsonFieldStreamer } from './json-field-streamer';

function extrair(pedacos: string[], campo = 'reply') {
  const streamer = new JsonFieldStreamer(campo);
  return pedacos.map((pedaco) => streamer.push(pedaco));
}

const caracteres = (texto: string) => [...texto];

describe('JsonFieldStreamer', () => {
  it('entrega o texto do campo conforme chega', () => {
    const json =
      '{"intent":"ajuda","ambiguous":false,"reply":"Olá, tudo bem?"}';

    expect(extrair(caracteres(json)).join('')).toBe('Olá, tudo bem?');
  });

  it('entrega o texto antes de o JSON terminar', () => {
    const saidas = extrair(['{"reply":"Olá', ', tudo', ' bem?"}']);

    expect(saidas).toEqual(['Olá', ', tudo', ' bem?']);
  });

  it('decodifica escapes, inclusive partidos entre pedaços', () => {
    const json = '{"reply":"linha 1\\nlinha \\"2\\" \\u00e9 \\\\ fim"}';

    expect(extrair(caracteres(json)).join('')).toBe(
      'linha 1\nlinha "2" é \\ fim',
    );
  });

  it('ignora o mesmo nome dentro de outro campo ou em objeto aninhado', () => {
    const json = JSON.stringify({
      entities: { reply: 'aninhado', description: '"reply":"falso"' },
      note: 'reply',
      reply: 'certo',
    });

    expect(extrair(caracteres(json)).join('')).toBe('certo');
  });

  it('não entrega nada quando o campo não é texto', () => {
    expect(extrair(['{"reply":null,"x":"y"}']).join('')).toBe('');
  });

  it('para no fim do campo', () => {
    expect(extrair(['{"reply":"a","depois":"b"}']).join('')).toBe('a');
  });
});
