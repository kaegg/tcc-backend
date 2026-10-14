import type { ConfigService } from '@nestjs/config';
import { isLocalHost, readOllamaSettings } from './ollama.config';

const configWith = (env: Record<string, string>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('readOllamaSettings', () => {
  it('usa os padrões quando nada é configurado', () => {
    expect(readOllamaSettings(configWith({}))).toEqual({
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:7b',
      timeoutMs: 60_000,
      maxInFlight: 4,
    });
  });

  it('lê os valores configurados e tira a barra final da URL', () => {
    const settings = readOllamaSettings(
      configWith({
        OLLAMA_BASE_URL: 'http://ollama:11434/',
        OLLAMA_MODEL: 'qwen2.5:14b',
        OLLAMA_TIMEOUT_MS: '30000',
        OLLAMA_MAX_IN_FLIGHT: '2',
      }),
    );

    expect(settings).toEqual({
      baseUrl: 'http://ollama:11434',
      model: 'qwen2.5:14b',
      timeoutMs: 30_000,
      maxInFlight: 2,
    });
  });

  it.each([
    ['https://api.ollama.com', /fora da rede local/],
    ['http://8.8.8.8:11434', /fora da rede local/],
    ['http://usuario:senha@localhost:11434', /credenciais/],
    ['ftp://localhost:11434', /http ou https/],
    ['http://localhost:11434/?x=1', /query string/],
    ['nao-e-url', /URL válida/],
  ])('recusa OLLAMA_BASE_URL=%s', (url, erro) => {
    expect(() =>
      readOllamaSettings(configWith({ OLLAMA_BASE_URL: url })),
    ).toThrow(erro);
  });

  it.each(['0', '-5', '1.5', 'abc'])('recusa OLLAMA_TIMEOUT_MS=%s', (valor) => {
    expect(() =>
      readOllamaSettings(configWith({ OLLAMA_TIMEOUT_MS: valor })),
    ).toThrow(/inteiro positivo/);
  });

  it.each(['qwen 2.5', 'modelo;rm -rf', '../x'])(
    'recusa OLLAMA_MODEL=%s',
    (modelo) => {
      expect(() =>
        readOllamaSettings(configWith({ OLLAMA_MODEL: modelo })),
      ).toThrow(/OLLAMA_MODEL/);
    },
  );
});

describe('isLocalHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'ollama',
    'host.docker.internal',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '[::1]',
    '::ffff:127.0.0.1',
    'fd12:3456::1',
  ])('aceita %s', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each([
    'api.ollama.com',
    'example.com',
    '8.8.8.8',
    '172.32.0.1',
    '2001:4860::8888',
    '::ffff:8.8.8.8',
  ])('recusa %s', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });
});
