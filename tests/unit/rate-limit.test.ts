import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, __resetRateLimitStore } from '@/lib/rate-limit';

// Deterministic sliding-window tests: we inject `now` so there is no wall-clock
// flakiness. Each test uses a unique key so the shared module store can't bleed
// across cases (and we also reset it in beforeEach).

beforeEach(() => __resetRateLimitStore());

describe('checkRateLimit', () => {
  it('allows up to the limit then trips with a 429-style deny', () => {
    const opts = { limit: 3, windowMs: 60_000, now: 1_000 };
    expect(checkRateLimit('k1', opts).ok).toBe(true);  // 1
    expect(checkRateLimit('k1', opts).ok).toBe(true);  // 2
    const third = checkRateLimit('k1', opts);
    expect(third.ok).toBe(true);                        // 3 (at limit)
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit('k1', opts);          // 4 → deny
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it('sets Retry-After to roughly the window remaining until the oldest hit ages out', () => {
    const limit = 2, windowMs = 60_000;
    checkRateLimit('k2', { limit, windowMs, now: 0 });      // oldest at t=0
    checkRateLimit('k2', { limit, windowMs, now: 10_000 }); // second at t=10s
    const denied = checkRateLimit('k2', { limit, windowMs, now: 20_000 });
    expect(denied.ok).toBe(false);
    // oldest(0) + window(60s) - now(20s) = 40s
    expect(denied.retryAfterSec).toBe(40);
  });

  it('recovers once the oldest hit slides out of the window', () => {
    const limit = 1, windowMs = 60_000;
    expect(checkRateLimit('k3', { limit, windowMs, now: 0 }).ok).toBe(true);
    expect(checkRateLimit('k3', { limit, windowMs, now: 30_000 }).ok).toBe(false);
    // 60_001ms later the first hit has expired → allowed again.
    expect(checkRateLimit('k3', { limit, windowMs, now: 60_001 }).ok).toBe(true);
  });

  it('isolates counters per key', () => {
    const opts = { limit: 1, windowMs: 60_000, now: 5 };
    expect(checkRateLimit('a', opts).ok).toBe(true);
    expect(checkRateLimit('b', opts).ok).toBe(true); // different key unaffected
    expect(checkRateLimit('a', opts).ok).toBe(false);
  });

  it('a denied request does not push the reset window further out', () => {
    const limit = 1, windowMs = 60_000;
    checkRateLimit('k4', { limit, windowMs, now: 0 });
    checkRateLimit('k4', { limit, windowMs, now: 1_000 }); // denied, not recorded
    // Reset still governed by the original hit at t=0, not the denied t=1000.
    expect(checkRateLimit('k4', { limit, windowMs, now: 60_001 }).ok).toBe(true);
  });

  it('a non-positive limit denies everything (kill switch)', () => {
    const r = checkRateLimit('k5', { limit: 0, windowMs: 60_000, now: 0 });
    expect(r.ok).toBe(false);
  });
});
