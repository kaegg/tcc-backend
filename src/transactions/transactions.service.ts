import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ownedActiveTransaction } from '../prisma/scopes';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto';
import { civilDateToUtc, utcToCivilDate } from './dto/transaction-rules';

export const LANCAMENTO_NAO_ENCONTRADO = 'Lançamento não encontrado.';

const WITH_CATEGORY_NAME = { category: { select: { name: true } } } as const;

/**
 * Ordem total e estável: data do fato, depois instante do registro e, por
 * fim, o id. Sem o desempate, lançamentos do mesmo dia trocariam de posição
 * entre uma página e a seguinte e um item apareceria duas vezes ou nenhuma.
 */
const NEWEST_FIRST = [
  { date: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] as const;

type Row = Prisma.TransactionGetPayload<{
  include: typeof WITH_CATEGORY_NAME;
}>;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * Cria o lançamento do usuário informado.
   *
   * Formulário e chatbot (TCC-022) passam por aqui (RNF12). `userId` e
   * `source` são argumentos de quem chama, nunca campos do corpo: o
   * controller entrega o id do token, e o chatbot informará 'assistente'.
   */
  async create(
    userId: string,
    dto: CreateTransactionDto,
    source: TransactionSource = 'formulario',
  ): Promise<TransactionResponseDto> {
    await this.categories.assertUsable(dto.categoryId, dto.type);

    const row = await this.prisma.transaction.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        type: dto.type,
        amount: dto.amount,
        date: civilDateToUtc(dto.date),
        description: dto.description,
        source,
      },
      include: WITH_CATEGORY_NAME,
    });

    return toResponse(row);
  }

  /**
   * Lançamentos do usuário, do mais recente ao mais antigo.
   *
   * `ownedActiveTransaction` é o único `where`: dono vindo do token e
   * exclusão lógica (RN07, RN09). Leitura e contagem rodam na mesma
   * transação para que `total` e `data` descrevam o mesmo instante.
   */
  async list(
    userId: string,
    query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponseDto> {
    const where = ownedActiveTransaction(userId);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: WITH_CATEGORY_NAME,
        orderBy: [...NEWEST_FIRST],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: rows.map(toResponse),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  /**
   * Um lançamento do usuário. Inexistente, de outro usuário e excluído
   * respondem igualmente 404: um 403 confirmaria que o id existe na conta de
   * alguém, e o cliente não tem como usar essa informação para nada legítimo.
   */
  async findOne(userId: string, id: string): Promise<TransactionResponseDto> {
    const row = await this.findRow(userId, id);

    if (!row) throw new NotFoundException(LANCAMENTO_NAO_ENCONTRADO);

    return toResponse(row);
  }

  private findRow(userId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, ...ownedActiveTransaction(userId) },
      include: WITH_CATEGORY_NAME,
    });
  }
}

/** Campo a campo: `userId` e `deletedAt` não podem sair por descuido. */
function toResponse(row: Row): TransactionResponseDto {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount.toFixed(2),
    date: utcToCivilDate(row.date),
    description: row.description,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
