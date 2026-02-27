import { describe, expect, it } from 'vitest';
import { evaluateActionThrottle } from './rate_limit';

describe('rate limit helpers', () => {
  it('join rate-limit blocks repeated attempts within 2s', () => {
    const first = evaluateActionThrottle(1_000, null);
    const second = evaluateActionThrottle(2_500, 1_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(500);
  });

  it('check-in rate-limit blocks repeated attempts within 2s', () => {
    const decision = evaluateActionThrottle(10_100, 9_000);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(900);
  });

  it('allows attempts after window has passed', () => {
    const decision = evaluateActionThrottle(12_500, 10_000);
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterMs).toBe(0);
  });

  it('self-heals future timestamps by allowing attempt', () => {
    const decision = evaluateActionThrottle(10_000, 30_000);
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterMs).toBe(0);
  });
});
