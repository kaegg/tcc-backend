import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { redactSecrets } from '../common/utils/redact';
import type { HealthResponseDto } from './dto/health-response.dto';

/**
 * Tempo maximo da consulta de verificacao.
 */
const DATABASE_PROBE_TIMEOUT_MS = 2000;

/**
 * Descreve a falha para o log.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const partes = [error.name, error.message].filter(
    (parte) => parte && parte.length > 0,
  );

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) partes.push(`code=${code}`);

  if (error.cause instanceof Error && error.cause.message) {
    partes.push(`causa: ${error.cause.message}`);
  } else if (typeof error.cause === 'string') {
    partes.push(`causa: ${error.cause}`);
  }

  return partes.join(' | ') || error.constructor.name;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponseDto> {
    const database = await this.checkDatabase();

    return {
      status: database.status === 'ok' ? 'ok' : 'degradado',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: { database },
    };
  }

  private async checkDatabase(): Promise<
    HealthResponseDto['dependencies']['database']
  > {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Tempo esgotado na verificacao do banco.')),
            DATABASE_PROBE_TIMEOUT_MS,
          );
        }),
      ]);

      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      // A mensagem do driver costuma trazer a cadeia de conexao com senha;
      // por isso passa por `redactSecrets` mesmo indo so para o log.
      this.logger.error(
        redactSecrets(`Verificacao do PostgreSQL falhou: ${describe(error)}`),
      );

      return { status: 'indisponivel' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
