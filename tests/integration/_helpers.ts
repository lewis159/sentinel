// Shared helpers for the DB-backed integration suite.
//
// The single guiding rule: everything here is a NO-OP / skip when DATABASE_URL is
// unset, so `npm run test:integration` is green on a machine with no database.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
export const hasDbUrl = DATABASE_URL.length > 0;
// Convenience negation used with vitest's describe.skipIf / describe.runIf.
export const NODB = !hasDbUrl;

// TLS: a plain local Postgres (docker-compose.test.yml, the CI service) has no
// TLS — set PGSSL=disable. Mirrors lib/db.ts.
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

const INIT_DIR = path.resolve(__dirname, '..', '..', 'db', 'init');

// Run one raw .sql file from db/init on a short-lived client. Multi-statement
// files are supported (node-postgres sends the whole text as a simple query).
export async function runSqlFile(file: string): Promise<void> {
  const sql = readFileSync(path.join(INIT_DIR, file), 'utf8');
  const client = new Client({ connectionString: DATABASE_URL, ssl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// A short message printed once so a skipped run is obviously intentional.
export const SKIP_MESSAGE =
  'DATABASE_URL not set — DB-backed integration tests skipped (this is expected off-CI).';
