import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ChatService } from './chat.service';

@Module({
  imports: [LlmModule],
  providers: [ChatService],
})
export class ChatModule {}
