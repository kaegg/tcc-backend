import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { activeCategory } from '../prisma/scopes';
import type { TransactionType } from '../generated/prisma/enums';
import type { CategoryResponseDto } from './dto/category-response.dto';

export const CATEGORIA_INVALIDA =
  'Categoria inválida para o tipo do lançamento.';

/**
 * Ponto único de acesso às categorias para os demais módulos.
 *
 * Formulário e chatbot criam lançamentos pelos mesmos serviços (RNF12), então
 * a regra "a categoria existe, está ativa e é do tipo do lançamento" mora aqui
 * e não em cada chamador. O banco já recusa o tipo incompatível pela chave
 * estrangeira composta (RN02); esta checagem existe para responder 400 com
 * mensagem útil em vez de deixar a violação virar erro interno.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Categorias em circulacao, opcionalmente restritas a um tipo.
   *
   * As categorias sao do sistema, compartilhadas por todos os usuarios, entao
   * nao ha recorte por dono — o unico escopo e `activeCategory`. Quem chama ja
   * passou pelo guard de autenticacao: "permitida ao usuario" significa
   * usuario autenticado e categoria ativa.
   */
  async findAll(type?: TransactionType): Promise<CategoryResponseDto[]> {
    const rows = await this.prisma.category.findMany({
      where: { ...activeCategory, ...(type ? { type } : {}) },
      // `select` explicito: `isActive` e os carimbos de tempo nem saem do banco.
      select: { id: true, name: true, type: true },
      // Enum do PostgreSQL ordena pela ordem de declaracao no schema, e nao em
      // ordem alfabetica: receita vem antes de despesa. E o desejado, mas
      // surpreende quem espera ordenacao por texto.
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    // Campo a campo: a saida nao depende de a consulta ter restringido o `select`.
    return rows.map(({ id, name, type }) => ({ id, name, type }));
  }

  /**
   * Garante que a categoria pode ser usada num lancamento do tipo dado.
   *
   * Inexistente, inativa e de outro tipo respondem exatamente igual: quem
   * chama nao descobre quais identificadores existem. O formato do id e
   * conferido antes da consulta porque o PostgreSQL rejeita texto que nao e
   * UUID com erro de driver.
   */
  async assertUsable(categoryId: string, type: TransactionType): Promise<void> {
    const usable =
      isUUID(categoryId) &&
      (await this.prisma.category.count({
        where: { id: categoryId, type, ...activeCategory },
      })) === 1;

    if (!usable) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [CATEGORIA_INVALIDA],
        fieldErrors: { categoryId: [CATEGORIA_INVALIDA] },
      });
    }
  }
}
