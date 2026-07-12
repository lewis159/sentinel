import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// DB-backed INTEGRATION test config for Sentinel/Hermes. Separate from the pure
// unit config (vitest.config.ts) so the two suites never run in the same pass:
//   * unit  (vitest.config.ts)            → tests/unit/**, no DB, mocks pg.
//   * integ (this file)                   → tests/integration/**, REAL Postgres.
//
// The integration suite ONLY does real work when DATABASE_URL is set; every test
// file skips cleanly otherwise (see tests/integration/_helpers.ts), so running
// `npm run test:integration` on a machine with no DB is a green no-op.
//
// Run locally:
//   docker compose -f docker-compose.test.yml up -d
//   DATABASE_URL=postgres://sentinel:sentinel@localhost:5433/sentinel_test \
//     PGSSL=disable HERMES_RLS_ENABLED=1 npm run test:integration
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // One shared Postgres database across the whole suite. The RLS file enables
    // row-level security on ops.tickets, so run files SERIALLY (never in parallel
    // workers) to keep the DB state deterministic across files.
    fileParallelism: false,
    // globalSetup bootstraps the schema (db/init/*.sql) into a bare DATABASE_URL
    // so the suite is self-contained; it no-ops when the schema already exists or
    // when DATABASE_URL is unset.
    globalSetup: ['tests/integration/global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
