import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CategoriesModule } from './categories/categories.module';
import { ReportsModule } from './reports/reports.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    PrismaModule,
    AuthModule, // TCC-009 - login, logout, sessao e controle de acesso
    UsersModule, // TCC-008 e TCC-010 - cadastro e perfil
    TransactionsModule, // TCC-012 a TCC-015 - lancamentos
    CategoriesModule, // TCC-011 - categorias financeiras
    ReportsModule, // TCC-016 e TCC-017 - relatorios e resumo mensal
    ChatModule, // TCC-021 e TCC-022 - chatbot e gateway Socket.IO
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
