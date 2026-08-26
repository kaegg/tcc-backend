import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Headers de seguranca.
  // A CSP padrao do Helmet bloqueia os estilos e scripts inline do Swagger UI e
  // a pagina da documentacao abre em branco; por isso as diretivas abaixo
  // liberam o minimo necessario, mantendo os demais headers ativos.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
        },
      },
    }),
  );

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    credentials: true,
  });

  // Documentacao da API.
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
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
