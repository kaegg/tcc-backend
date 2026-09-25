import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ownedActiveTransaction } from '../prisma/scopes';
import { transactionFilters } from '../transactions/transaction-filters';
import type { PeriodSummaryResponseDto } from './dto/period-summary-response.dto';
import type { ReportPeriodQueryDto } from './dto/report-period-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Receitas, despesas e saldo do período (RF13, RN04).
   *
   * Formulário e chatbot (TCC-027) passam por aqui. O período usa o mesmo
   * `transactionFilters` da listagem, e o escopo de dono e exclusão lógica vem
   * por último no `where` (RN07, RN09): relatório e lista filtrada pelo mesmo
   * período somam exatamente os mesmos lançamentos.
   *
   * A soma é feita pelo banco, em `numeric`, e o saldo em `Decimal`: nada
   * passa por ponto flutuante.
   */
  async periodSummary(
    userId: string,
    period: ReportPeriodQueryDto,
  ): Promise<PeriodSummaryResponseDto> {
    const groups = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        ...transactionFilters({ from: period.from, to: period.to }),
        ...ownedActiveTransaction(userId),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const totalOf = (type: 'receita' | 'despesa') =>
      groups.find((group) => group.type === type)?._sum.amount ??
      new Prisma.Decimal(0);

    const income = totalOf('receita');
    const expense = totalOf('despesa');

    return {
      from: period.from,
      to: period.to,
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      balance: income.minus(expense).toFixed(2),
      transactionCount: groups.reduce(
        (acc, group) => acc + group._count._all,
        0,
      ),
    };
  }
}
