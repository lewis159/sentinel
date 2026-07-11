// Bounded in-memory SLIDING-WINDOW rate limiter for the P2 public intake surface.
//
// WHY IN-MEMORY: Sentinel has no shared Redis client today (no `redis`/`ioredis`
// dependency in package.json — grep confirms it). This limiter therefore lives in
// the memory of a SINGLE container process. Consequences to be aware of:
//   • PER-INSTANCE ONLY — with N replicas the effective ceiling is N × the cap.
//   • Resets on restart/redeploy.
// For the public support-chat surface (whose token is exposed in the browser,
// so anyone can read it and hammer the LLM-backed chat route) a per-instance
// limiter is still a meaningful first line of defence against runaway LLM spend
// and ticket spam. If/when Sentinel scales horizontally, swap the `store` for the
// estate Redis and keep `checkRateLimit()`'s contract unchanged.
//
// The store is BOUNDED (MAX_KEYS) so an attacker rotating spoofed keys (e.g. many
// X-Forwarded-For values) cannot grow it without limit — oldest keys are evicted.

export interface RateLimitResult {
  ok: boolean;
  /** The configured ceiling for this window. */
  limit: number;
  /** Approximate remaining allowance in the current window (>= 0). */
  remaining: number;
  /** Seconds until the caller may retry (0 when allowed). For Retry-After. */
  retryAfterSec: number;
}

export interface RateLimitOptions {
  /** Max hits allowed within `windowMs`. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Injectable clock for tests. Defaults to Date.now(). */
  now?: number;
}

// key -> ascending list of hit timestamps (ms) within (or near) the window.
const store = new Map<string, number[]>();

// Hard ceiling on distinct tracked keys → bounded memory under key-rotation abuse.
const MAX_KEYS = 20_000;

// Throttle housekeeping so a hot path does not sweep the whole map every call.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

// Drop buckets whose newest hit is older than `horizonMs` (fully expired), and
// enforce MAX_KEYS by evicting oldest-inserted keys (Map preserves insert order).
function housekeep(now: number, horizonMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) {
    // Still enforce the hard cap cheaply even between sweeps.
    if (store.size <= MAX_KEYS) return;
  }
  lastSweep = now;
  for (const [k, hits] of store) {
    const last = hits.length ? hits[hits.length - 1] : 0;
    if (now - last > horizonMs) store.delete(k);
  }
  if (store.size > MAX_KEYS) {
    const overflow = store.size - MAX_KEYS;
    let i = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++i >= overflow) break;
    }
  }
}

/**
 * Record a hit for `key` and decide whether it is within the limit, using a
 * sliding-window log. Allowed hits are recorded; denied hits are NOT recorded
 * (so a blocked caller cannot push its own reset further out).
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = opts;
  const now = opts.now ?? Date.now();

  if (limit <= 0) {
    // A non-positive limit disables the route entirely.
    return { ok: false, limit, remaining: 0, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  housekeep(now, windowMs);

  const windowStart = now - windowMs;
  const existing = store.get(key);
  // Prune timestamps that have aged out of the window.
  const hits = existing ? existing.filter((t) => t > windowStart) : [];

  if (hits.length >= limit) {
    const oldest = hits[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    // Persist the pruned bucket so it doesn't regrow from stale entries.
    store.set(key, hits);
    return { ok: false, limit, remaining: 0, retryAfterSec };
  }

  hits.push(now);
  store.set(key, hits);
  return { ok: true, limit, remaining: Math.max(0, limit - hits.length), retryAfterSec: 0 };
}

/** Test-only: clear all buckets. Not used in request paths. */
export function __resetRateLimitStore(): void {
  store.clear();
  lastSweep = 0;
}
