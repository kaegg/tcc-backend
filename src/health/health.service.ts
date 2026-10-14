import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { describeError } from '../common/utils/describe-error';
import { redactSecrets } from '../common/utils/redact';
import { OllamaService } from '../llm/ollama.service';
import type { HealthResponseDto } from './dto/health-response.dto';

/**
 * Tempo maximo da consulta de verificacao.
 */
const DATABASE_PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [database, llm] = await Promise.all([
      this.checkDatabase(),
      this.ollama.probe(),
    ]);

    // O LLM fica fora do estado agregado: o HEALTHCHECK do Docker usa o status
    // HTTP, e Ollama fora derrubaria a aplicação inteira em vez de só o chatbot.
    return {
      status: database.status === 'ok' ? 'ok' : 'degradado',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: { database, llm },
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
        redactSecrets(
          `Verificacao do PostgreSQL falhou: ${describeError(error)}`,
        ),
      );

      return { status: 'indisponivel' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
