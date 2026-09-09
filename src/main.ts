import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './configure-app';

async function bootstrap() {
  // `bodyParser: false` desliga os parsers automaticos para que `configureApp`
  // os registre com limite explicito de tamanho.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Antes do Swagger: o documento so inclui o prefixo global se ele ja estiver
  // definido quando `createDocument` roda.
  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('IntelliFinance API')
    .setDescription(
      'API REST do sistema de gestao financeira com suporte a interface ' +
        'conversacional utilizando LLM (TCC 2026).',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    `${API_PREFIX}/docs`,
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
