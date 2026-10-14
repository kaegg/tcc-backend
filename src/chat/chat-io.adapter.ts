import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { buildCorsOriginChecker } from '../common/cors-origins';
import { MAX_PAYLOAD_BYTES } from './chat.protocol';

/**
 * O gateway não herda o `enableCors` nem o Helmet do Express, então as
 * restrições de rede do socket ficam aqui, lidas do mesmo `CORS_ORIGIN`.
 */
export class ChatIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
    private readonly onRejected?: (origin: string) => void,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const checkOrigin = buildCorsOriginChecker(
      this.allowedOrigins,
      this.onRejected,
    );

    return super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      // Sem long-polling: cada requisição de polling seria uma superfície HTTP
      // a mais, fora do CORS, do Helmet e do limite de corpo do Express.
      transports: ['websocket'],
      maxHttpBufferSize: MAX_PAYLOAD_BYTES,
      connectTimeout: 10_000,
      serveClient: false,
      cors: { origin: checkOrigin, credentials: false },
      // CORS não vale para o upgrade de WebSocket: o navegador conecta de
      // qualquer página. A origem precisa ser conferida aqui também.
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null | undefined, allow: boolean) => void,
      ) =>
        checkOrigin(request.headers.origin, (error, allow) =>
          callback(error ? error.message : null, allow === true),
        ),
    });
  }
}
