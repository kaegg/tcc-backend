import { isIP } from 'node:net';
import type { ConfigService } from '@nestjs/config';

export const OLLAMA_SETTINGS = Symbol('OLLAMA_SETTINGS');

export interface OllamaSettings {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxInFlight: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5:7b';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_IN_FLIGHT = 4;

const MODEL_NAME = /^[a-z0-9][a-z0-9._/-]*(:[a-z0-9][a-z0-9._-]*)?$/i;

export function readOllamaSettings(config: ConfigService): OllamaSettings {
  return {
    baseUrl: parseBaseUrl(config.get<string>('OLLAMA_BASE_URL')),
    model: parseModel(config.get<string>('OLLAMA_MODEL')),
    timeoutMs: positiveInt(config, 'OLLAMA_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxInFlight: positiveInt(
      config,
      'OLLAMA_MAX_IN_FLIGHT',
      DEFAULT_MAX_IN_FLIGHT,
    ),
  };
}

/**
 * RNF06: os dados financeiros não podem sair para provedor externo. Um
 * `OLLAMA_BASE_URL` apontando para fora da rede local mandaria cada mensagem do
 * usuário para terceiros sem nenhum outro sinal; por isso a aplicação recusa
 * subir. Nome sem ponto é aceito por ser como o Docker resolve outro serviço do
 * compose (`http://ollama:11434`).
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'host.docker.internal') return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);

  return !host.includes('.');
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(ip: string): boolean {
  if (ip === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return /^f[cd][0-9a-f]{2}:/.test(ip);
}

function parseBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OLLAMA_BASE_URL não é uma URL válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OLLAMA_BASE_URL deve usar http ou https.');
  }
  if (url.username || url.password) {
    throw new Error('OLLAMA_BASE_URL não pode conter credenciais.');
  }
  if (url.search || url.hash) {
    throw new Error('OLLAMA_BASE_URL não pode conter query string nem âncora.');
  }
  if (!isLocalHost(url.hostname)) {
    throw new Error(
      `OLLAMA_BASE_URL aponta para fora da rede local (${url.hostname}). ` +
        'A inferência precisa rodar localmente (RNF06).',
    );
  }

  return url.toString().replace(/\/+$/, '');
}

function parseModel(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_MODEL;
  if (!MODEL_NAME.test(value)) {
    throw new Error(`OLLAMA_MODEL inválido: ${value}`);
  }
  return value;
}

function positiveInt(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} deve ser um inteiro positivo.`);
  }

  return value;
}
