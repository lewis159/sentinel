import { Pool } from 'pg';

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

export async function q<T = any>(text: string, params?: any[]): Promise<T[]> {
  if (!pool) return [];
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function q1<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
