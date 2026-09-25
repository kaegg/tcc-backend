import type { Prisma } from '../generated/prisma/client';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { civilDateToUtc } from './dto/transaction-rules';

/**
 * O `contains` do Prisma 7 vira `ILIKE ('%' || $1 || '%')` sem escapar os
 * curingas (verificado no SQL gerado). O valor vai parametrizado, então não há
 * injeção de SQL, mas `%` digitado na busca casaria com tudo. A barra
 * invertida é o escape padrão do LIKE no PostgreSQL.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Só os filtros informados entram no `where`; ausente não filtra. */
export function transactionFilters(
  query: Pick<
    ListTransactionsQueryDto,
    'from' | 'to' | 'type' | 'categoryId' | 'search'
  >,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};

  if (query.type) where.type = query.type;
  if (query.categoryId) where.categoryId = query.categoryId;

  if (query.from || query.to) {
    where.date = {
      ...(query.from && { gte: civilDateToUtc(query.from) }),
      ...(query.to && { lte: civilDateToUtc(query.to) }),
    };
  }

  if (query.search) {
    where.description = {
      contains: escapeLike(query.search),
      mode: 'insensitive',
    };
  }

  return where;
}
