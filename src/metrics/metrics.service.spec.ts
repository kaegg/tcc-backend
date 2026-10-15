import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { RecordMetricDto } from './dto/record-metric.dto';
import { MetricsService } from './metrics.service';

const AGORA = new Date('2026-10-14T15:00:00.000Z');

const metrica: RecordMetricDto = {
  participantCode: '7b2f9c1e-4a3d-4e8f-9b6a-1c2d3e4f5a6b',
  sessionCode: '0f1e2d3c-4b5a-4968-8776-655443322110',
  mode: 'assistente',
  task: 'registro-despesa',
  durationMs: 42_500,
  interactionCount: 3,
  errorCount: 1,
  outcome: 'sucesso',
};

describe('MetricsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    usageMetric: { create: jest.Mock };
  };

  function servico(coleta: string | undefined) {
    const service = new MetricsService(
      prisma as unknown as PrismaService,
      { get: () => coleta } as unknown as ConfigService,
    );
    service.now = () => AGORA;
    return service;
  }

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ termsAcceptedAt: new Date('2026-10-01') }),
      },
      usageMetric: { create: jest.fn().mockResolvedValue({}) },
    };
  });

  it('grava a tarefa sem nada que leve à conta', async () => {
    await servico('true').record('u1', metrica);

    expect(prisma.usageMetric.create).toHaveBeenCalledWith({
      data: {
        participantCode: metrica.participantCode,
        sessionCode: metrica.sessionCode,
        mode: 'assistente',
        taskCode: 'registro-despesa',
        startedAt: new Date('2026-10-14T14:59:17.500Z'),
        finishedAt: AGORA,
        durationMs: 42_500,
        interactionCount: 3,
        errorCount: 1,
        outcome: 'sucesso',
      },
    });
    expect(JSON.stringify(prisma.usageMetric.create.mock.calls)).not.toContain(
      'u1',
    );
  });

  it.each([undefined, 'false', 'TRUE', '1', ''])(
    'USAGE_METRICS_ENABLED=%p não grava nada',
    async (valor) => {
      const service = servico(valor);

      await service.record('u1', metrica);

      expect(prisma.usageMetric.create).not.toHaveBeenCalled();
      expect(await service.status('u1')).toEqual({ collecting: false });
    },
  );

  it('conta sem aceite dos termos (anterior a eles) não entra na coleta', async () => {
    prisma.user.findUnique.mockResolvedValue({ termsAcceptedAt: null });
    const service = servico('true');

    await service.record('u1', metrica);

    expect(prisma.usageMetric.create).not.toHaveBeenCalled();
    expect(await service.status('u1')).toEqual({ collecting: false });
  });

  it('coleta ligada e termos aceitos: o navegador deve medir', async () => {
    expect(await servico('true').status('u1')).toEqual({ collecting: true });
  });
});
