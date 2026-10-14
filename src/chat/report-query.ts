import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { TransactionType } from '../generated/prisma/enums';
import type { CategoryTotalDto } from '../reports/dto/monthly-summary-response.dto';
import { ReportOverviewQueryDto } from '../reports/dto/report-overview-query.dto';
import type { ReportOverviewResponseDto } from '../reports/dto/report-overview-response.dto';
import type { Period, PeriodReading } from './extraction/periods';
import { formatAmount } from './extraction/registration-reply';
import { categoryInText } from './extraction/registration';
import {
  comparable,
  type CategoryOption,
  type InterpretationContext,
} from './interpretation/entities';

export type QueryIntent = 'consultar_relatorio' | 'obter_resumo';

/** O que a pergunta quer saber do período. */
export type QueryFocus = 'despesa' | 'receita' | 'saldo' | 'resumo';

export interface ReportQuery {
  intent: QueryIntent;
  focus: QueryFocus;
  category: CategoryOption | null;
}

const BALANCE =
  /\b(saldo|sobrou|sobra|sobraram|economizei|economizou|economia|guardei|poupei|balanco)\b/;
const SUMMARY =
  /\b(resumo|panorama|visao geral|relatorio|como (?:estou|estao|ficou|ficaram|foi|foram))\b/;
const EXPENSES =
  /\b(gastei|gastou|gastamos|gasto|gastos|despesas?|paguei|pagamentos?|comprei|compras?|saidas?)\b/;
const INCOMES =
  /\b(recebi|recebeu|recebemos|receitas?|ganhei|ganhos?|entrou|entradas?|rendas?|rendimentos?)\b/;

function typeInText(normalized: string): TransactionType | null {
  const expense = EXPENSES.test(normalized);
  const income = INCOMES.test(normalized);
  if (expense === income) return null;
  return expense ? 'despesa' : 'receita';
}

/** Nome vindo do modelo (enum das ativas) ou citado na mensagem. */
function findCategory(
  name: string | null,
  type: TransactionType | null,
  context: InterpretationContext,
): CategoryOption | null {
  if (!name) return null;
  const matches = context.categories.filter(
    (item) => comparable(item.name) === comparable(name),
  );
  if (matches.length === 1) return matches[0];
  return matches.find((item) => item.type === type) ?? null;
}

/**
 * O que a mensagem pergunta. Sem nenhum sinal novo — a resposta "este mês" a
 * "de qual período?" —, vale o que a pergunta anterior pedia.
 */
export function readQuery(
  intent: QueryIntent,
  normalized: string,
  model: Record<string, unknown> | null,
  context: InterpretationContext,
  previous: ReportQuery | null,
): ReportQuery {
  const textType = typeInText(normalized);
  const modelType =
    model?.type === 'receita' || model?.type === 'despesa' ? model.type : null;
  const modelCategory =
    intent === 'consultar_relatorio' && typeof model?.category === 'string'
      ? model.category
      : null;

  const category = findCategory(
    modelCategory ?? categoryInText(normalized, context, textType),
    textType ?? modelType,
    context,
  );

  let focus: QueryFocus | null = null;
  if (category) focus = category.type;
  else if (BALANCE.test(normalized)) focus = 'saldo';
  else if (SUMMARY.test(normalized)) focus = 'resumo';
  else if (textType) focus = textType;
  else if (modelType) focus = modelType;

  if (!focus && previous) return { ...previous, intent };
  return { intent, focus: focus ?? 'resumo', category };
}

/**
 * Mesmas regras do período da tela de relatórios (`/reports/overview`): data
 * válida, início antes do fim e no máximo 24 meses, com as mesmas mensagens.
 */
export function checkPeriod(period: Period): string | null {
  const dto = plainToInstance(ReportOverviewQueryDto, period);
  const [error] = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return error ? Object.values(error.constraints ?? {})[0] : null;
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function civil(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "em outubro de 2026 (01/10/2026 a 31/10/2026)": sempre com as datas. */
export function describePeriod(
  { from, to }: Period,
  reference: string,
): string {
  if (from === to) {
    if (from === reference) return `hoje (${civil(from)})`;
    return `em ${civil(from)}`;
  }

  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const range = `${civil(from)} a ${civil(to)}`;

  if (fd === 1 && fy === ty && fm === tm && td === lastDay(ty, tm)) {
    return `em ${MONTH_NAMES[fm - 1]} de ${fy} (${range})`;
  }
  if (fy === ty && fm === 1 && fd === 1 && tm === 12 && td === 31) {
    return `em ${fy} (${range})`;
  }
  return `de ${range}`;
}

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const percent = (share: string) =>
  `${Number(share).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const entries = (count: number) =>
  `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`;

const countOf = (items: CategoryTotalDto[]) =>
  items.reduce((total, item) => total + item.transactionCount, 0);

function topCategories(items: CategoryTotalDto[]): string {
  return joinPt(
    items
      .slice(0, 3)
      .map(
        (item) =>
          `${item.categoryName} (${formatAmount(item.total)}; ${percent(item.share)})`,
      ),
  );
}

function categoryReply(
  when: string,
  category: CategoryOption,
  report: ReportOverviewResponseDto,
): string {
  const expense = category.type === 'despesa';
  const list = expense ? report.expenseByCategory : report.incomeByCategory;
  const item = list.find((entry) => entry.categoryId === category.id);
  const kind = expense ? 'despesas' : 'receitas';

  if (!item) return `${when}, não há ${kind} em ${category.name}.`;
  return `${when}, você ${expense ? 'gastou' : 'recebeu'} ${formatAmount(item.total)} em ${category.name}, em ${entries(item.transactionCount)} — ${percent(item.share)} das ${kind} do período.`;
}

function typeReply(
  when: string,
  type: TransactionType,
  report: ReportOverviewResponseDto,
): string {
  const expense = type === 'despesa';
  const items = expense ? report.expenseByCategory : report.incomeByCategory;
  const kind = expense ? 'despesas' : 'receitas';
  const count = countOf(items);

  if (count === 0) return `${when}, não há ${kind} registradas.`;

  const total = formatAmount(expense ? report.expense : report.income);
  const head = `${when}, suas ${kind} somaram ${total}, em ${entries(count)}.`;
  if (items.length === 1) return `${head} Todas em ${items[0].categoryName}.`;
  return `${head} ${items.length > 3 ? 'As maiores categorias foram' : 'Por categoria:'} ${topCategories(items)}.`;
}

function balanceReply(when: string, report: ReportOverviewResponseDto): string {
  const head = `${when}, suas receitas somaram ${formatAmount(report.income)} e suas despesas, ${formatAmount(report.expense)}.`;
  const balance = Number(report.balance);

  if (balance > 0) {
    const share = report.savingsRate
      ? `, o equivalente a ${percent(report.savingsRate)} das receitas`
      : '';
    return `${head} O saldo ficou positivo em ${formatAmount(report.balance)}${share}.`;
  }
  if (balance < 0) {
    return `${head} O saldo ficou negativo em ${formatAmount(report.balance.slice(1))}: as despesas superaram as receitas.`;
  }
  return `${head} O saldo ficou zerado.`;
}

function summaryReply(when: string, report: ReportOverviewResponseDto): string {
  const head = `${when}: receitas de ${formatAmount(report.income)}, despesas de ${formatAmount(report.expense)} e saldo de ${formatAmount(report.balance)}, em ${entries(report.transactionCount)}.`;
  return report.expenseByCategory.length > 0
    ? `${head} Maiores despesas: ${topCategories(report.expenseByCategory)}.`
    : head;
}

/**
 * Resposta escrita pelo backend com os números do `ReportsService` — o mesmo
 * da tela de relatórios. O modelo não escreve nada aqui: poderia arredondar,
 * somar errado ou inventar um total (critério da TCC-027). Sem aconselhamento:
 * só os fatos do período (RN08).
 */
export function composeReportReply(
  query: ReportQuery,
  report: ReportOverviewResponseDto,
  reference: string,
): string {
  const when = capitalize(
    describePeriod({ from: report.from, to: report.to }, reference),
  );

  if (report.transactionCount === 0) {
    return `${when}, não há lançamentos registrados.`;
  }
  if (query.category) return categoryReply(when, query.category, report);
  switch (query.focus) {
    case 'despesa':
    case 'receita':
      return typeReply(when, query.focus, report);
    case 'saldo':
      return balanceReply(when, report);
    case 'resumo':
      return summaryReply(when, report);
  }
}

export const PERIOD_EXAMPLES =
  'Por exemplo: “este mês”, “mês passado”, “setembro” ou “de 01/09 a 15/09”.';

/** Pergunta quando o período não pode ser lido com segurança. */
export function periodQuestion(
  reading: Exclude<PeriodReading, { kind: 'resolvido' }>,
  reference: string,
): string {
  switch (reading.kind) {
    case 'ausente':
      return `De qual período? ${PERIOD_EXAMPLES}`;
    case 'impreciso':
      return `Não consegui saber o período exato. ${PERIOD_EXAMPLES}`;
    case 'invalido':
      return `Essa data não existe no calendário. Qual período você quer consultar? ${PERIOD_EXAMPLES}`;
    case 'multiplos':
      return `A mensagem cita mais de um período (${joinPt(reading.options.map((period) => describePeriod(period, reference).replace(/^em /, '')))}). Qual deles? Para juntar, diga, por exemplo, “de setembro a outubro”.`;
  }
}
