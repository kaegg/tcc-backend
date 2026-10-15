import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.decorator';
import { CollectionStatusDto } from './dto/collection-status.dto';
import { RecordMetricDto } from './dto/record-metric.dto';
import { MetricsService } from './metrics.service';

/** Métricas de uso do estudo comparativo (TCC-030, RF27). */
@ApiTags('metrics')
@ApiBearerAuth()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() user: AuthenticatedUser): Promise<CollectionStatusDto> {
    return this.metrics.status(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordMetricDto,
  ): Promise<void> {
    return this.metrics.record(user.id, dto);
  }
}
