import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import type { Namespace, Socket } from 'socket.io';
import { describeError } from '../common/utils/describe-error';
import { redactSecrets } from '../common/utils/redact';
import { LlmError } from '../llm/llm.errors';
import { ChatAuthService, type SocketUser } from './chat-auth.service';
import {
  CHAT_NAMESPACE,
  ChatEvent,
  chatError,
  parseCancel,
  parseCancelOperation,
  parseConfirmOperation,
  parseEditOperation,
  parseSendMessage,
  type ChatErrorCode,
  type SendMessageAck,
  type SendMessagePayload,
} from './chat.protocol';
import { ChatService, type OperationFailure } from './chat.service';
import { RateLimiter } from './rate-limiter';

const MESSAGES_PER_MINUTE = 12;
const MAX_CONNECTIONS_PER_USER = 3;

interface ChatSocketData {
  user: SocketUser;
}

const userOf = (socket: Socket): SocketUser =>
  (socket.data as ChatSocketData).user;

/**
 * O `ThrottlerGuard` global só entende HTTP; o limite do chat é o
 * `RateLimiter` por usuário abaixo.
 */
@SkipThrottle()
@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly limiter = new RateLimiter(MESSAGES_PER_MINUTE, 60_000);
  private readonly connections = new Map<string, number>();
  private readonly inFlight = new Map<
    string,
    { id: string; controller: AbortController }
  >();

  constructor(
    private readonly chat: ChatService,
    private readonly auth: ChatAuthService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      // O token vai em `auth`, nunca na query: a URL do upgrade aparece em
      // log de proxy.
      const token = (socket.handshake.auth as { token?: unknown }).token;

      this.auth
        .authenticate(token)
        .then((user) => {
          if (!user) return next(connectError('sessao_expirada'));
          if (
            (this.connections.get(user.id) ?? 0) >= MAX_CONNECTIONS_PER_USER
          ) {
            return next(connectError('limite_excedido'));
          }
          (socket.data as ChatSocketData).user = user;
          next();
        })
        .catch((error: unknown) => {
          this.logger.error(
            redactSecrets(
              `Falha ao autenticar socket: ${describeError(error)}`,
            ),
          );
          next(connectError('erro_interno'));
        });
    });
  }

  handleConnection(socket: Socket): void {
    const { id } = userOf(socket);
    this.connections.set(id, (this.connections.get(id) ?? 0) + 1);
  }

  handleDisconnect(socket: Socket): void {
    this.inFlight.get(socket.id)?.controller.abort();
    this.inFlight.delete(socket.id);

    const user = userOf(socket);
    const remaining = (this.connections.get(user.id) ?? 1) - 1;
    if (remaining > 0) this.connections.set(user.id, remaining);
    else this.connections.delete(user.id);
  }

  @SubscribeMessage(ChatEvent.send)
  async onSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: unknown,
  ): Promise<SendMessageAck> {
    const payload = parseSendMessage(raw);
    if (!payload) return reject('mensagem_invalida');

    // A vaga é reservada antes do `await`: duas mensagens seguidas passariam
    // juntas pela checagem enquanto a sessão é consultada.
    if (this.inFlight.has(socket.id)) return reject('ocupado');
    const controller = new AbortController();
    this.inFlight.set(socket.id, { id: payload.id, controller });

    const user = userOf(socket);
    let refusal: ChatErrorCode | null = null;
    if (!(await this.auth.isStillValid(user))) refusal = 'sessao_expirada';
    else if (!this.limiter.tryConsume(user.id)) refusal = 'limite_excedido';

    if (refusal) {
      this.inFlight.delete(socket.id);
      return reject(refusal);
    }

    void this.stream(socket, user, payload, controller);

    return { ok: true };
  }

  @SubscribeMessage(ChatEvent.cancel)
  onCancel(@ConnectedSocket() socket: Socket, @MessageBody() raw: unknown) {
    const id = parseCancel(raw);
    const current = this.inFlight.get(socket.id);
    if (id && current?.id === id) current.controller.abort();
  }

  /** Desistir do lançamento em andamento pelo botão, sem digitar "cancelar". */
  @SubscribeMessage(ChatEvent.cancelOperation)
  async onCancelOperation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: unknown,
  ): Promise<{ ok: true; reply: string } | SendMessageAck> {
    const conversationId = parseCancelOperation(raw);
    if (!conversationId) return reject('mensagem_invalida');

    const user = userOf(socket);
    if (!(await this.auth.isStillValid(user))) return reject('sessao_expirada');
    // Durante a resposta, o lançamento ainda pode ser atualizado por ela.
    if (this.inFlight.has(socket.id)) return reject('ocupado');

    return {
      ok: true,
      reply: this.chat.cancelPending(user.id, conversationId),
    };
  }

  /** Registra o lançamento proposto, na versão que o cartão mostra. */
  @SubscribeMessage(ChatEvent.confirmOperation)
  async onConfirmOperation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: unknown,
  ) {
    const payload = parseConfirmOperation(raw);
    if (!payload) return reject('mensagem_invalida');

    return this.exclusive(socket, async (user) => {
      const result = await this.chat.confirmPending(
        user.id,
        payload.conversationId,
        payload.proposalId,
      );
      if (!result.ok) return rejectOperation(result);
      return { ok: true as const, reply: result.reply };
    });
  }

  /** Correção feita no cartão; o lançamento continua aguardando confirmação. */
  @SubscribeMessage(ChatEvent.editOperation)
  async onEditOperation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: unknown,
  ) {
    const payload = parseEditOperation(raw);
    if (!payload) return reject('mensagem_invalida');

    return this.exclusive(socket, async (user) => {
      const result = await this.chat.editPending(
        user.id,
        payload.conversationId,
        payload.proposalId,
        payload.values,
      );
      if (!result.ok) return rejectOperation(result);
      return { ok: true as const, pending: result.pending };
    });
  }

  /**
   * Confirmar e editar ocupam a mesma vaga de uma mensagem: enquanto uma
   * resposta pode alterar o lançamento, ele não é gravado nem editado.
   */
  private async exclusive<T>(
    socket: Socket,
    action: (user: SocketUser) => Promise<T>,
  ): Promise<T | SendMessageAck> {
    if (this.inFlight.has(socket.id)) return reject('ocupado');
    const controller = new AbortController();
    this.inFlight.set(socket.id, { id: '', controller });

    try {
      const user = userOf(socket);
      if (!(await this.auth.isStillValid(user))) {
        return reject('sessao_expirada');
      }
      return await action(user);
    } catch (error) {
      this.logger.error(
        redactSecrets(`Falha no lançamento do chat: ${describeError(error)}`),
      );
      return reject('erro_interno');
    } finally {
      if (this.inFlight.get(socket.id)?.controller === controller) {
        this.inFlight.delete(socket.id);
      }
    }
  }

  private async stream(
    socket: Socket,
    user: SocketUser,
    payload: SendMessagePayload,
    controller: AbortController,
  ): Promise<void> {
    try {
      const reply = this.chat.streamReply(
        user.id,
        payload.conversationId,
        payload.content,
        controller.signal,
      );
      let step = await reply.next();
      while (!step.done) {
        socket.emit(ChatEvent.chunk, { id: payload.id, text: step.value });
        step = await reply.next();
      }
      socket.emit(ChatEvent.end, {
        id: payload.id,
        pending: this.chat.pendingSummary(user.id, payload.conversationId),
        outcome: step.value.outcome ?? null,
        report: step.value.report ?? null,
      });
    } catch (error) {
      let code: ChatErrorCode = 'erro_interno';
      if (error instanceof LlmError) code = error.kind;
      else {
        this.logger.error(
          redactSecrets(`Falha no chat: ${describeError(error)}`),
        );
      }
      socket.emit(ChatEvent.error, { id: payload.id, ...chatError(code) });
    } finally {
      if (this.inFlight.get(socket.id)?.controller === controller) {
        this.inFlight.delete(socket.id);
      }
    }
  }
}

function reject(code: ChatErrorCode): SendMessageAck {
  return { ok: false, ...chatError(code) };
}

/** A mensagem é a do primeiro campo reprovado, como no `ValidationPipe`. */
function rejectOperation(failure: OperationFailure) {
  const first = Object.values(failure.fieldErrors ?? {}).flat()[0];
  return {
    ...reject(failure.code),
    ...(first ? { message: first } : {}),
    ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
  };
}

function connectError(code: ChatErrorCode): Error {
  const { message } = chatError(code);
  return Object.assign(new Error(message), { data: { code } });
}
