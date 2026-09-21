import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { parseCorsOrigins } from '../common/cors-origins';

/**
 * Defesa contra CSRF nas rotas que dependem só do cookie de refresh.
 *
 * Além de SameSite=Strict no cookie, confere o header `Origin`, que o
 * navegador preenche em todo POST e que a página não consegue forjar. Sem o
 * header a requisição não veio de um navegador, e só navegador envia cookie
 * sozinho.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: string[];

  constructor(config: ConfigService) {
    this.allowed = parseCorsOrigins(
      config.get<string>('CORS_ORIGIN', 'http://localhost:5173'),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (!origin) return true;

    if (!this.allowed.includes(origin.replace(/\/+$/, '').toLowerCase())) {
      throw new ForbiddenException('Origem não autorizada.');
    }

    return true;
  }
}
