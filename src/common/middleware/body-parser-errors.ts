import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { ErrorRequestHandler } from 'express';

/**
 * Traduz as falhas do body-parser para excecoes HTTP do Nest.
 *
 * Precisa rodar logo depois dos parsers, e nao no filtro global, por dois
 * motivos:
 *
 * 1. O parser nao lanca `HttpException`, e sim `http-errors`. Sem tratamento,
 *    um corpo grande demais cai no ramo generico do filtro e responde 500 em
 *    vez de 413 — o limite "funciona" com o status errado.
 * 2. O Nest reescreve `SyntaxError` como `BadRequestException(err.message)`
 *    antes de qualquer filtro ver o erro (`routes-resolver`,
 *    `mapExternalException`). Quando o filtro e chamado, a informacao de que
 *    aquilo veio do parser ja se perdeu, e a mensagem crua do motor de
 *    JavaScript ja tomou o lugar da nossa. Aqui o erro ainda esta inteiro.
 *
 * O texto original nunca e repassado: ele revela o limite configurado, o
 * tamanho recebido e a posicao do caractere que quebrou o parse.
 */
export function bodyParserErrorHandler(): ErrorRequestHandler {
  return (err: unknown, _req, _res, next) => {
    const parserError = asBodyParserError(err);

    if (!parserError) {
      next(err);
      return;
    }

    switch (parserError.type) {
      case 'entity.too.large':
        next(
          new PayloadTooLargeException(
            'Corpo da requisição excede o limite permitido.',
          ),
        );
        return;

      case 'entity.parse.failed':
        next(
          new BadRequestException('Corpo da requisição não é um JSON válido.'),
        );
        return;

      case 'encoding.unsupported':
      case 'charset.unsupported':
        next(
          new UnsupportedMediaTypeException(
            'Codificação do corpo da requisição não é suportada.',
          ),
        );
        return;

      case 'request.aborted':
        next(
          new BadRequestException(
            'A requisição foi interrompida antes de ser concluída.',
          ),
        );
        return;

      default:
        next(new BadRequestException('Corpo da requisição inválido.'));
    }
  };
}

/**
 * Reconhece um erro do body-parser.
 *
 * O pacote marca cada falha com um `type` proprio e usa `expose` para dizer se
 * o erro e de responsabilidade de quem chamou. Erros 5xx vem com
 * `expose: false` e seguem adiante, para o tratamento generico.
 */
function asBodyParserError(err: unknown): { type: string } | null {
  if (typeof err !== 'object' || err === null) return null;

  const candidate = err as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };

  if (typeof candidate.type !== 'string') return null;
  if (candidate.expose !== true) return null;

  const status =
    typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.status === 'number'
        ? candidate.status
        : null;

  if (status === null || status < 400 || status >= 500) return null;

  return { type: candidate.type };
}
