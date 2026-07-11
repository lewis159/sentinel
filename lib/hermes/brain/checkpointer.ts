// LangGraph Postgres checkpointer on a DEDICATED `hermes` schema.
//
// The checkpointer is what gives the Brain durable, per-thread memory AND the
// pause/resume that powers gated actions: when the graph interrupts before a
// gated tool, its state is checkpointed here; the Approve path resumes from that
// exact checkpoint and runs the tool for real.
//
// Same Postgres instance as `ops.*` (DATABASE_URL) but its own `hermes` schema
// (PostgresSaver's native `schema` option), so Brain state never mingles with the
// console's tables. Memoized across hot-reloads; setup() (idempotent table
// creation) runs once. Returns null when there's no DB — callers degrade to a
// stateless single-turn reply.
import 'server-only';
import { Pool } from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const HERMES_SCHEMA = 'hermes';

declare global {
  // eslint-disable-next-line no-var
  var _hermesSaver: PostgresSaver | null | undefined;
  // eslint-disable-next-line no-var
  var _hermesSaverSetup: Promise<void> | undefined;
}

function makePool(url: string): Pool {
  // Mirror lib/db.ts SSL handling (Patroni/Spilo self-signed cert; PGSSL=disable
  // for a plain local Postgres). The saver qualifies its tables with the schema
  // option below, so no search_path juggling is needed here.
  const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: url, max: 3, ssl });
}

// Build (once) the Postgres checkpointer. Returns null with no DATABASE_URL.
export async function getCheckpointer(): Promise<PostgresSaver | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  if (global._hermesSaver === undefined) {
    const pool = makePool(url);
    // `schema` places checkpoints/checkpoint_writes/etc. in the hermes schema.
    global._hermesSaver = new PostgresSaver(pool, undefined, { schema: HERMES_SCHEMA });
  }
  const saver = global._hermesSaver;
  if (!saver) return null;

  // Idempotently ensure the schema exists (belt-and-braces alongside migration
  // 11) then run the library's setup() exactly once per process.
  if (!global._hermesSaverSetup) {
    global._hermesSaverSetup = (async () => {
      const pool = makePool(url);
      try {
        await pool.query(`create schema if not exists ${HERMES_SCHEMA}`);
      } finally {
        await pool.end().catch(() => {});
      }
      await saver.setup();
    })();
  }
  await global._hermesSaverSetup;
  return saver;
}
