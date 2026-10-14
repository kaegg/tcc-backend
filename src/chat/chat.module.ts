import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { ChatAuthService } from './chat-auth.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, LlmModule],
  providers: [ChatService, ChatAuthService, ChatGateway],
})
export class ChatModule {}
