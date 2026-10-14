import type { ReportQuery } from './report-query';

const IDLE_TTL_MS = 15 * 60 * 1000;
const MAX_PER_USER = 20;

/**
 * Consulta que aguarda o período ("quanto gastei?" → "de qual período?"), por
 * usuário e conversa, com a mesma expiração e o mesmo teto do lançamento
 * pendente. Só guarda o que foi perguntado: nada aqui é executado sem período.
 */
export class PendingQueries {
  private readonly byUser = new Map<
    string,
    Map<string, { query: ReportQuery; updatedAt: number }>
  >();

  constructor(private readonly now: () => number = Date.now) {}

  get(userId: string, conversationId: string): ReportQuery | null {
    const entry = this.byUser.get(userId)?.get(conversationId);
    if (!entry) return null;
    if (entry.updatedAt < this.now() - IDLE_TTL_MS) {
      this.delete(userId, conversationId);
      return null;
    }
    return entry.query;
  }

  set(userId: string, conversationId: string, query: ReportQuery): void {
    let queries = this.byUser.get(userId);
    if (!queries) {
      queries = new Map();
      this.byUser.set(userId, queries);
    }
    queries.delete(conversationId);
    queries.set(conversationId, { query, updatedAt: this.now() });

    while (queries.size > MAX_PER_USER) {
      const [oldest] = queries.keys();
      queries.delete(oldest);
    }
  }

  delete(userId: string, conversationId: string): void {
    const queries = this.byUser.get(userId);
    queries?.delete(conversationId);
    if (queries?.size === 0) this.byUser.delete(userId);
  }
}
