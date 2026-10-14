import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OLLAMA_SETTINGS, readOllamaSettings } from './ollama.config';
import { OllamaService } from './ollama.service';

@Module({
  providers: [
    {
      provide: OLLAMA_SETTINGS,
      inject: [ConfigService],
      useFactory: readOllamaSettings,
    },
    OllamaService,
  ],
  exports: [OllamaService],
})
export class LlmModule {}
