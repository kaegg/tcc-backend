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
import type {
  MonthTotalsDto,
  ReportOverviewResponseDto,
} from './dto/report-overview-response.dto';
import type { ReportPeriodQueryDto } from './dto/report-period-query.dto';
import { monthsInPeriod, monthToPeriod } from './report-month';

type TransactionType = 'receita' | 'despesa';

const ZERO = new Prisma.Decimal(0);

/** Soma de um tipo numa categoria, já agregada. */
interface CategoryRow {
  type: TransactionType;
  categoryId: string;
  total: Prisma.Decimal;
  transactionCount: number;
}

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

    return totals(
      period,
      totalOf('receita'),
      totalOf('despesa'),
      groups.reduce((acc, group) => acc + group._count._all, 0),
    );
  }

  /**
   * Resumo do mês com distribuição por categoria (RF14).
   *
   * Uma só consulta agrupada por tipo e categoria, e os totais do mês são a
   * soma dessas mesmas linhas: a distribuição fecha com o total por
   * construção, e não por duas consultas que teriam de concordar. O `where` é
   * o mesmo do `periodSummary`, então o resumo de setembro e o relatório de
   * 01/09 a 30/09 dão os mesmos números.
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

    const rows: CategoryRow[] = groups.map((group) => ({
      type: group.type,
      categoryId: group.categoryId,
      total: group._sum.amount ?? ZERO,
      transactionCount: group._count._all,
    }));

    return { month, ...(await this.withDistribution(period, rows)) };
  }

  /**
   * Tudo o que a tela de relatórios mostra para um período (RF15): totais,
   * distribuição por categoria e a série mês a mês.
   *
   * Cartões, gráficos e tabela saem desta única consulta, agrupada por tipo,
   * categoria e dia. Os três recortes são somas das mesmas linhas, então não
   * há como o gráfico mensal e o cartão de total discordarem, nem como um
   * filtro de período alcançar um componente e não o outro.
   */
  async overview(
    userId: string,
    period: ReportPeriodQueryDto,
  ): Promise<ReportOverviewResponseDto> {
    const groups = await this.prisma.transaction.groupBy({
      by: ['type', 'categoryId', 'date'],
      where: periodWhere(userId, period),
      _sum: { amount: true },
      _count: { _all: true },
    });

    const byCategory = new Map<string, CategoryRow>();
    const months = new Map(
      monthsInPeriod(period).map((bucket) => [
        bucket.month,
        { ...bucket, income: ZERO, expense: ZERO, transactionCount: 0 },
      ]),
    );

    for (const group of groups) {
      const amount = group._sum.amount ?? ZERO;
      const count = group._count._all;

      const key = `${group.type}:${group.categoryId}`;
      const row = byCategory.get(key) ?? {
        type: group.type,
        categoryId: group.categoryId,
        total: ZERO,
        transactionCount: 0,
      };
      byCategory.set(key, {
        ...row,
        total: row.total.plus(amount),
        transactionCount: row.transactionCount + count,
      });

      // `date` é a data civil à meia-noite UTC; os 7 primeiros caracteres são o mês.
      const month = months.get(group.date.toISOString().slice(0, 7));
      if (month) {
        if (group.type === 'receita') month.income = month.income.plus(amount);
        else month.expense = month.expense.plus(amount);
        month.transactionCount += count;
      }
    }

    return {
      ...(await this.withDistribution(period, [...byCategory.values()])),
      months: [...months.values()].map((m): MonthTotalsDto => ({
        month: m.month,
        from: m.from,
        to: m.to,
        income: m.income.toFixed(2),
        expense: m.expense.toFixed(2),
        balance: m.income.minus(m.expense).toFixed(2),
        transactionCount: m.transactionCount,
      })),
    };
  }

  /**
   * Totais e distribuição a partir das mesmas linhas por categoria. O nome vem
   * de toda categoria referenciada, inclusive as que saíram de circulação
   * (`is_active = false`): o lançamento antigo continua contando e precisa
   * aparecer com o nome que tinha.
   */
  private async withDistribution(
    period: { from: string; to: string },
    rows: CategoryRow[],
  ) {
    const categories = rows.length
      ? await this.prisma.category.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.categoryId))] } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(categories.map((c) => [c.id, c.name]));

    const income = distribution(rows, 'receita', nameOf);
    const expense = distribution(rows, 'despesa', nameOf);

    return {
      ...totals(
        period,
        income.total,
        expense.total,
        rows.reduce((acc, row) => acc + row.transactionCount, 0),
      ),
      incomeByCategory: income.items,
      expenseByCategory: expense.items,
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

function totals(
  period: { from: string; to: string },
  income: Prisma.Decimal,
  expense: Prisma.Decimal,
  transactionCount: number,
): PeriodSummaryResponseDto {
  const balance = income.minus(expense);

  return {
    from: period.from,
    to: period.to,
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    balance: balance.toFixed(2),
    // Quanto das receitas sobrou. Sem receita não há base: nulo, e não zero,
    // para a tela não afirmar "0% de economia" num mês só de despesas.
    savingsRate: income.isZero()
      ? null
      : balance.div(income).times(100).toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    transactionCount,
  };
}

function distribution(
  rows: CategoryRow[],
  type: TransactionType,
  nameOf: Map<string, string>,
): { total: Prisma.Decimal; items: CategoryTotalDto[] } {
  const ofType = rows
    .filter((row) => row.type === type)
    .map((row) => ({ ...row, categoryName: nameOf.get(row.categoryId) ?? '' }));
  const total = ofType.reduce((acc, row) => acc.plus(row.total), ZERO);

  // Maior primeiro; empate pelo nome, para a ordem não variar entre consultas.
  ofType.sort(
    (a, b) =>
      b.total.comparedTo(a.total) ||
      a.categoryName.localeCompare(b.categoryName, 'pt-BR'),
  );

  return {
    total,
    items: ofType.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      total: row.total.toFixed(2),
      transactionCount: row.transactionCount,
      share: total.isZero()
        ? '0.00'
        : row.total
            .div(total)
            .times(100)
            .toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    })),
  };
}
