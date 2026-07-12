// Global setup for the DB-backed integration suite.
//
// Bootstraps the Sentinel `ops`/`hermes` schema (db/init/01..17) into whatever
// DATABASE_URL points at, so `npm run test:integration` works against a BARE
// Postgres with nothing but a connection string. It is:
//   * a NO-OP when DATABASE_URL is unset (the whole suite skips), and
//   * a NO-OP when the schema is already present (CI loads it via a psql step,
//     and docker-compose.test.yml loads it via /docker-entrypoint-initdb.d), so
//     re-running is safe and fast.
//
// Migration 13 (pgvector) is TOLERATED-skippable: if the Postgres image lacks
// the `vector` extension we log a warning and continue, since no integration
// test touches hermes.kb_chunks. Use pgvector/pgvector:pg16 to load it cleanly.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // No DB → the suite skips; nothing to bootstrap.
    return;
  }

  const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };
  const client = new Client({ connectionString: url, ssl });
  await client.connect();

  try {
    // Already bootstrapped? The exactly-once ledger table is a good sentinel for
    // "the P3 substrate migrations ran". If present, assume the full schema is
    // loaded (CI/compose path) and do nothing.
    const { rows } = await client.query(
      `select to_regclass('ops.hermes_tool_executions') as t`,
    );
    if (rows[0]?.t) {
      return;
    }

    const dir = path.resolve(__dirname, '..', '..', 'db', 'init');
    const files = readdirSync(dir)
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort(); // 01_.. 02_.. ... 17_.. — lexical order matches the numeric prefix.

    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      try {
        await client.query(sql);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        const isVectorMigration = /_hermes_kb\.sql$/.test(f) || /^13_/.test(f);
        const isVectorError = /vector|extension/i.test(msg);
        if (isVectorMigration && isVectorError) {
          // pgvector not available in this image — skip the KB store. No
          // integration test depends on it.
          // eslint-disable-next-line no-console
          console.warn(
            `[integration global-setup] skipping ${f}: pgvector unavailable (${msg}). ` +
              `Use pgvector/pgvector:pg16 to load it.`,
          );
          continue;
        }
        throw new Error(`[integration global-setup] failed loading ${f}: ${msg}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[integration global-setup] loaded ${files.length} migration file(s) into ${redact(url)}`);
  } finally {
    await client.end();
  }
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<db>';
  }
}
