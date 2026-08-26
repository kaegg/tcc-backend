import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { redactSecrets } from '../utils/redact';

/** Formato unico de erro da API */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Mensagem devolvida em qualquer falha nao prevista.
 */
const GENERIC_MESSAGE =
  'Erro interno no servidor. Tente novamente em instantes.';

const SERVER_ERROR: number = HttpStatus.INTERNAL_SERVER_ERROR;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.buildBody(exception, request.url);

    if (body.statusCode >= SERVER_ERROR) {
      this.logger.error(
        redactSecrets(
          `${request.method} ${request.url} -> ${body.statusCode}: ${describeError(exception)}`,
        ),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(exception: unknown, path: string): ApiErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          statusCode,
          error: exception.name,
          message: payload,
          path,
          timestamp,
        };
      }

      const { message, error } = payload as {
        message?: string | string[];
        error?: string;
      };

      return {
        statusCode,
        error: error ?? exception.name,
        message: message ?? exception.message,
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: GENERIC_MESSAGE,
      path,
      timestamp,
    };
  }
}

function describeError(exception: unknown): string {
  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}`;
  }
  return String(exception);
}
