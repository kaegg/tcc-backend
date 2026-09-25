import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.decorator';
import { MonthlySummaryQueryDto } from './dto/monthly-summary-query.dto';
import { MonthlySummaryResponseDto } from './dto/monthly-summary-response.dto';
import { PeriodSummaryResponseDto } from './dto/period-summary-response.dto';
import { ReportPeriodQueryDto } from './dto/report-period-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Totais só dos lançamentos ativos do usuário do token. */
  @Get('summary')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PeriodSummaryResponseDto })
  @ApiBadRequestResponse({
    description:
      'Periodo ausente, data invalida ou fim anterior ao inicio. O corpo traz `fieldErrors`.',
  })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() period: ReportPeriodQueryDto,
  ): Promise<PeriodSummaryResponseDto> {
    return this.reports.periodSummary(user.id, period);
  }

  @Get('monthly')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: MonthlySummaryResponseDto })
  @ApiBadRequestResponse({
    description:
      'Mes ausente ou fora do formato AAAA-MM. O corpo traz `fieldErrors`.',
  })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  monthly(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MonthlySummaryQueryDto,
  ): Promise<MonthlySummaryResponseDto> {
    return this.reports.monthlySummary(user.id, query.month);
  }
}
