import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { LlmModule } from '../llm/llm.module';
import { ReportsModule } from '../reports/reports.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ChatAuthService } from './chat-auth.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [
    AuthModule,
    CategoriesModule,
    LlmModule,
    TransactionsModule,
    ReportsModule,
  ],
  providers: [ChatService, ChatAuthService, ChatGateway],
})
export class ChatModule {}
