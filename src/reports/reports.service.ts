import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ownedActiveTransaction } from '../prisma/scopes';
import { transactionFilters } from '../transactions/transaction-filters';
import type {
  CategoryTotalDto,
  MonthlySummaryResponseDto,
} from './dto/monthly-summary-response.dto';
import type { PeriodSummaryResponseDto } from './dto/period-summary-response.dto';
import type { ReportPeriodQueryDto } from './dto/report-period-query.dto';
import { monthToPeriod } from './report-month';

type TransactionType = 'receita' | 'despesa';

const ZERO = new Prisma.Decimal(0);

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
      where: periodWhere(userId, period),
      _sum: { amount: true },
      _count: { _all: true },
    });

    const totalOf = (type: TransactionType) =>
      groups.find((group) => group.type === type)?._sum.amount ?? ZERO;

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

  /**
   * Resumo do mês com distribuição por categoria (RF14).
   *
   * Uma só consulta agrupada por tipo e categoria, e os totais do mês são a
   * soma dessas mesmas linhas: a distribuição fecha com o total por
   * construção, e não por duas consultas que teriam de concordar. O `where` é
   * o mesmo do `periodSummary`, então o resumo de setembro e o relatório de
   * 01/09 a 30/09 dão os mesmos números.
   *
   * O nome vem de toda categoria referenciada, inclusive as que saíram de
   * circulação (`is_active = false`): o lançamento antigo continua contando e
   * precisa aparecer com o nome que tinha.
   */
  async monthlySummary(
    userId: string,
    month: string,
  ): Promise<MonthlySummaryResponseDto> {
    const period = monthToPeriod(month);

    const groups = await this.prisma.transaction.groupBy({
      by: ['type', 'categoryId'],
      where: periodWhere(userId, period),
      _sum: { amount: true },
      _count: { _all: true },
    });

    const categories = groups.length
      ? await this.prisma.category.findMany({
          where: { id: { in: [...new Set(groups.map((g) => g.categoryId))] } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(categories.map((c) => [c.id, c.name]));

    const byType = (type: TransactionType) => {
      const rows = groups
        .filter((group) => group.type === type)
        .map((group) => ({
          categoryId: group.categoryId,
          categoryName: nameOf.get(group.categoryId) ?? '',
          total: group._sum.amount ?? ZERO,
          transactionCount: group._count._all,
        }));
      const total = rows.reduce((acc, row) => acc.plus(row.total), ZERO);

      // Maior primeiro; empate pelo nome, para a ordem não variar entre consultas.
      rows.sort(
        (a, b) =>
          b.total.comparedTo(a.total) ||
          a.categoryName.localeCompare(b.categoryName, 'pt-BR'),
      );

      return { total, rows: rows.map((row) => toCategoryTotal(row, total)) };
    };

    const income = byType('receita');
    const expense = byType('despesa');

    return {
      month,
      from: period.from,
      to: period.to,
      income: income.total.toFixed(2),
      expense: expense.total.toFixed(2),
      balance: income.total.minus(expense.total).toFixed(2),
      transactionCount: groups.reduce(
        (acc, group) => acc + group._count._all,
        0,
      ),
      incomeByCategory: income.rows,
      expenseByCategory: expense.rows,
    };
  }
}

/**
 * Período, dono do token e exclusão lógica, nessa ordem: o escopo vem por
 * último para nenhum filtro sobrescrevê-lo (RN07, RN09).
 */
function periodWhere(
  userId: string,
  period: { from: string; to: string },
): Prisma.TransactionWhereInput {
  return {
    ...transactionFilters({ from: period.from, to: period.to }),
    ...ownedActiveTransaction(userId),
  };
}

function toCategoryTotal(
  row: {
    categoryId: string;
    categoryName: string;
    total: Prisma.Decimal;
    transactionCount: number;
  },
  typeTotal: Prisma.Decimal,
): CategoryTotalDto {
  return {
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    total: row.total.toFixed(2),
    transactionCount: row.transactionCount,
    share: typeTotal.isZero()
      ? '0.00'
      : row.total
          .div(typeTotal)
          .times(100)
          .toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
  };
}
