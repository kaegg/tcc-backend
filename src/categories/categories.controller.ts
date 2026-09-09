import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CategoryListResponseDto } from './dto/category-response.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /**
   * Lista as categorias ativas do sistema.
   *
   * Somente leitura nesta etapa: criar, editar e desativar categoria e escopo
   * da TCC-011.
   */
  @Get()
  @ApiOkResponse({ type: CategoryListResponseDto })
  async list(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponseDto> {
    return { data: await this.categories.findAll(query.type) };
  }
}
