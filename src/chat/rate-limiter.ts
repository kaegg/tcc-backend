/** Janela deslizante por chave, em memória. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (at) => at > now - this.windowMs,
    );

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
