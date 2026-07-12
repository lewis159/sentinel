import { Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

// Sentinel's OWN local Postgres (the sentinel-db container). DATABASE_URL is set
// by the stack. A single pooled connection, reused across hot-reloads in dev.
const url = process.env.DATABASE_URL;
export const hasDb = Boolean(url);

declare global {
  // eslint-disable-next-line no-var
  var _sentinelPool: Pool | undefined;
}

// Patroni/Spilo requires SSL (hostssl); the cert is self-signed so don't verify.
// Set PGSSL=disable for a plain local Postgres without TLS.
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

export const pool: Pool | null = url
  ? (global._sentinelPool ?? (global._sentinelPool = new Pool({ connectionString: url, max: 5, ssl })))
  : null;

// --- Transaction-pinned client context (Hermes P3 tenant RLS) --------------
// AsyncLocalStorage carrying the "current" pooled client for the duration of a
// withDbTransaction() callback. When set, q/q1 run on that single pinned client
// instead of grabbing a fresh connection from the pool — so any `SET LOCAL`
// GUCs applied at the top of the transaction are visible to every query inside
// the callback. When UNSET (the default, i.e. every path today), q/q1 behave
// exactly as before (pool.query). This is the sole coupling that lets the
// additive tenant-RLS wrapper in lib/data.ts scope existing query functions
// without rewriting them.
const txClient = new AsyncLocalStorage<PoolClient>();

export async function q<T = any>(text: string, params?: any[]): Promise<T[]> {
  // If we're inside a withDbTransaction() scope, run on the pinned client so the
  // request-local GUCs set on it apply. Otherwise use the shared pool as before.
  const pinned = txClient.getStore();
  if (pinned) {
    const res = await pinned.query(text, params);
    return res.rows as T[];
  }
  if (!pool) return [];
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function q1<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

// Run `fn` inside a single pooled connection wrapped in a transaction, applying
// the given request-local settings (via set_config(name, value, is_local=true)
// — the parameterised, injection-safe equivalent of `SET LOCAL name = value`)
// BEFORE `fn` executes. Every q/q1 issued inside `fn` runs on that pinned
// connection (see txClient above), so the settings are visible to them; because
// they are LOCAL (transaction-scoped), COMMIT/ROLLBACK discards them, so a
// connection returned to the pool NEVER leaks a GUC into the next request. This
// is the pool-safe primitive behind lib/data.ts's tenant-RLS wrapper.
//
// Fail-safe fallbacks:
//   * No pool (no DATABASE_URL) → runs `fn` unchanged (its own no-DB fallbacks
//     fire); nothing to scope.
//   * Already inside a txClient scope → reuse the existing pinned client + its
//     already-applied settings instead of opening a nested transaction.
//   * Any error → ROLLBACK (never COMMIT partial work) and rethrow; the client
//     is always released.
export async function withDbTransaction<T>(
  settings: Array<{ name: string; value: string }>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!pool) return fn();
  if (txClient.getStore()) return fn(); // nested — reuse the outer transaction.

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const s of settings) {
      // set_config(setting, value, is_local) — is_local=true == SET LOCAL, i.e.
      // scoped to this transaction only. Parameterised so a tenant id can never
      // be a SQL-injection vector (plain `SET LOCAL` cannot bind parameters).
      await client.query('select set_config($1, $2, true)', [s.name, s.value]);
    }
    const result = await txClient.run(client, fn);
    await client.query('commit');
    return result;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore rollback failure — surface the original error */
    }
    throw e;
  } finally {
    client.release();
  }
}
