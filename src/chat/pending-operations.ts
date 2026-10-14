import type { EntityName } from './interpretation/entities';
import type { RegistrationState } from './extraction/registration';

export interface PendingOperation {
  intent: 'registrar_lancamento';
  state: RegistrationState;
  /** Mensagens seguidas em que cada campo continuou sem resposta. */
  attempts: Partial<Record<EntityName, number>>;
  updatedAt: number;
}

const IDLE_TTL_MS = 15 * 60 * 1000;
const MAX_PER_USER = 20;

/**
 * Lançamento em preparo, por usuário e conversa. Fica no servidor, como o
 * histórico: o cliente não consegue injetar um estado "completo" que pule as
 * perguntas. Em memória — reiniciar o backend descarta o que não foi
 * confirmado, e nada foi gravado.
 */
export class PendingOperations {
  private readonly byUser = new Map<string, Map<string, PendingOperation>>();

  constructor(private readonly now: () => number = Date.now) {}

  get(userId: string, conversationId: string): PendingOperation | null {
    const operation = this.byUser.get(userId)?.get(conversationId);
    if (!operation) return null;
    if (operation.updatedAt < this.now() - IDLE_TTL_MS) {
      this.delete(userId, conversationId);
      return null;
    }
    return operation;
  }

  set(
    userId: string,
    conversationId: string,
    operation: Omit<PendingOperation, 'updatedAt'>,
  ): void {
    let operations = this.byUser.get(userId);
    if (!operations) {
      operations = new Map();
      this.byUser.set(userId, operations);
    }
    operations.delete(conversationId);
    operations.set(conversationId, { ...operation, updatedAt: this.now() });

    while (operations.size > MAX_PER_USER) {
      const [oldest] = operations.keys();
      operations.delete(oldest);
    }
  }

  delete(userId: string, conversationId: string): boolean {
    const operations = this.byUser.get(userId);
    const removed = operations?.delete(conversationId) ?? false;
    if (operations?.size === 0) this.byUser.delete(userId);
    return removed;
  }
}
