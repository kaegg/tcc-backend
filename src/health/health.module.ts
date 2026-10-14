import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Verificacao de disponibilidade.
 */
@Module({
  imports: [LlmModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
