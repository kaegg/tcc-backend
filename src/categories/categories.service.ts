import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { activeCategory } from '../prisma/scopes';
import type { TransactionType } from '../generated/prisma/enums';
import type { CategoryResponseDto } from './dto/category-response.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Categorias em circulacao, opcionalmente restritas a um tipo.
   *
   * As categorias sao do sistema, compartilhadas por todos os usuarios, entao
   * nao ha recorte por dono — o unico escopo e `activeCategory`.
   */
  async findAll(type?: TransactionType): Promise<CategoryResponseDto[]> {
    return this.prisma.category.findMany({
      where: { ...activeCategory, ...(type ? { type } : {}) },
      // `select` explicito em vez de devolver a linha inteira: `isActive` e os
      // carimbos de tempo nem chegam a sair do banco, entao nao dependem de o
      // mapeamento lembrar de omiti-los.
      select: { id: true, name: true, type: true },
      // Enum do PostgreSQL ordena pela ordem de declaracao no schema, e nao em
      // ordem alfabetica: receita vem antes de despesa. E o desejado, mas
      // surpreende quem espera ordenacao por texto.
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }
}
