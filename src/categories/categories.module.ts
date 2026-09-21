import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  providers: [CategoriesService],
  controllers: [CategoriesController],
  // Transacoes (TCC-012) e chatbot (TCC-022) validam categoria por aqui.
  exports: [CategoriesService],
})
export class CategoriesModule {}
