import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
   * Somente leitura, de proposito: nao existe perfil administrativo, entao
   * qualquer rota de escrita seria acessivel a todo usuario autenticado e
   * alteraria o que todos veem. As categorias entram pelo seed e saem de
   * circulacao por `is_active`, nunca por exclusao.
   */
  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: CategoryListResponseDto })
  @ApiBadRequestResponse({ description: 'Filtro `type` invalido.' })
  @ApiUnauthorizedResponse({ description: 'Sessao invalida ou expirada.' })
  async list(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponseDto> {
    return { data: await this.categories.findAll(query.type) };
  }
}
