import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { CollectionStatusDto } from './dto/collection-status.dto';
import type { RecordMetricDto } from './dto/record-metric.dto';

@Injectable()
export class MetricsService {
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Só `true` liga a coleta. O padrão é desligado: os testes em produção não
   * entram na base da pesquisa a menos que a coleta seja ligada de propósito.
   */
  get enabled(): boolean {
    return this.config.get<string>('USAGE_METRICS_ENABLED') === 'true';
  }

  /** Diz ao navegador se vale medir; desligado, ele nem conta. */
  async status(userId: string): Promise<CollectionStatusDto> {
    return { collecting: this.enabled && (await this.acceptedTerms(userId)) };
  }

  /**
   * Grava uma tarefa medida. A conta só é usada para conferir o aceite dos
   * termos: a linha não guarda nada que leve a ela. Com a coleta desligada ou
   * sem aceite, a métrica é descartada em silêncio — o navegador não tem o que
   * fazer com um erro aqui.
   */
  async record(userId: string, dto: RecordMetricDto): Promise<void> {
    if (!this.enabled || !(await this.acceptedTerms(userId))) return;

    const finishedAt = this.now();
    await this.prisma.usageMetric.create({
      data: {
        participantCode: dto.participantCode,
        sessionCode: dto.sessionCode,
        mode: dto.mode,
        taskCode: dto.task,
        startedAt: new Date(finishedAt.getTime() - dto.durationMs),
        finishedAt,
        durationMs: dto.durationMs,
        interactionCount: dto.interactionCount,
        errorCount: dto.errorCount,
        outcome: dto.outcome,
      },
    });
  }

  private async acceptedTerms(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { termsAcceptedAt: true },
    });
    return Boolean(user?.termsAcceptedAt);
  }
}
