import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('libera até o limite e de novo quando a janela passa', () => {
    let agora = 0;
    const limiter = new RateLimiter(2, 1000, () => agora);

    expect(limiter.tryConsume('u1')).toBe(true);
    expect(limiter.tryConsume('u1')).toBe(true);
    expect(limiter.tryConsume('u1')).toBe(false);
    expect(limiter.tryConsume('u2')).toBe(true);

    agora = 1001;
    expect(limiter.tryConsume('u1')).toBe(true);
  });
});
