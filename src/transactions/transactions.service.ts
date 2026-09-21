import { Injectable } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import type { TransactionSource } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { TransactionResponseDto } from './dto/transaction-response.dto';
import { civilDateToUtc, utcToCivilDate } from './dto/transaction-rules';

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
    });

    return {
      id: row.id,
      type: row.type,
      amount: row.amount.toFixed(2),
      date: utcToCivilDate(row.date),
      description: row.description,
      categoryId: row.categoryId,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
