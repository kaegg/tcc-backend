import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import {
  buildCorsOriginChecker,
  parseCorsOrigins,
} from './common/cors-origins';
import { bodyParserErrorHandler } from './common/middleware/body-parser-errors';

/**
 * Prefixo de todas as rotas REST. A documentacao fica em `/api/docs`.
 */
export const API_PREFIX = 'api';

/**
 * Limite de corpo das requisicoes.
 *
 * Coincide com o padrao do Express; declarado explicitamente para ficar
 * auditavel e ter um lugar unico para a TCC-021 aumentar, se o historico do
 * chat exigir.
 */
const BODY_LIMIT = '100kb';

/**
 * Configuracao de infraestrutura da aplicacao.
 *
 * Extraida de `main.ts` pelo mesmo motivo que os padroes transversais viraram
 * provider no CommonModule: os testes e2e montam a aplicacao pelo AppModule e
 * nunca executam `bootstrap()`. Com o prefixo e o CORS so no `main.ts`, os
 * testes exercitariam `/categories` enquanto o processo real serve
 * `/api/categories` — passando por provar o oposto do que roda.
 *
 * A ordem importa: quem chama precisa invocar esta funcao ANTES de
 * `SwaggerModule.createDocument`, senao o documento sai sem o prefixo e todo
 * "Try it out" responde 404 com a API no ar.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const logger = new Logger('CORS');

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

  const allowedOrigins = parseCorsOrigins(
    config.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
  );

  if (allowedOrigins.length === 0) {
    logger.warn(
      'CORS_ORIGIN vazia: nenhuma origem de navegador podera consumir a API.',
    );
  }

  app.enableCors({
    origin: buildCorsOriginChecker(allowedOrigins, (origin) =>
      logger.warn(`Origem bloqueada pelo CORS: ${origin}`),
    ),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  app.setGlobalPrefix(API_PREFIX);

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });

  // Logo depois dos parsers, para alcancar as falhas deles antes que o Nest as
  // reescreva e a informacao de origem se perca.
  app.use(bodyParserErrorHandler());
}
