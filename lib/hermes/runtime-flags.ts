// Server-only runtime resolver for Hermes feature flags.
//
// The flags (HERMES_BRAIN_ENABLED, HERMES_INTAKE_ENABLED, HERMES_KB_PGVECTOR,
// HERMES_INNGEST_ENABLED) have an ENV DEFAULT (lib/hermes/brain/flags.ts). This
// module layers a DB OVERRIDE on top of that default so an admin can toggle a
// flag from the Integrations admin page with NO redeploy:
//
//   resolve order:  DB override (ops.hermes_runtime_flags) → env default.
//
// Mock-safe: with no DATABASE_URL (hasDb === false) there is no override store,
// so every flag resolves to its env default and setRuntimeFlag reports a clear
// "no database" error. The DB read NEVER throws — any failure (table missing, DB
// down) silently falls back to the env default so a flag lookup can never break a
// request path.
//
// NEXT_PUBLIC_* flags are inlined at build time and CANNOT be runtime-toggled;
// only the server-read flags below are eligible.

import 'server-only';
import { hasDb, q, q1 } from '@/lib/db';
import {
  brainEnabled,
  intakeEnabled,
  kbPgvectorEnabled,
  telegramEnabled,
} from '@/lib/hermes/brain/flags';

// Small env boolean parser, matching the semantics of the sync flag helpers.
function parseBool(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// The flags this store is allowed to manage, each with its ENV DEFAULT resolver.
// Reusing the sync helpers from flags.ts keeps a single source of truth for the
// three primary flags; HERMES_INNGEST_ENABLED reads env directly.
export const RUNTIME_FLAG_DEFAULTS: Record<string, () => boolean> = {
  HERMES_BRAIN_ENABLED: brainEnabled,
  HERMES_INTAKE_ENABLED: intakeEnabled,
  HERMES_KB_PGVECTOR: kbPgvectorEnabled,
  HERMES_INNGEST_ENABLED: () => parseBool(process.env.HERMES_INNGEST_ENABLED),
  HERMES_TELEGRAM_ENABLED: telegramEnabled,
};

/** True when `flag` is one this store is allowed to manage. */
export function isKnownFlag(flag: string): boolean {
  return Object.prototype.hasOwnProperty.call(RUNTIME_FLAG_DEFAULTS, flag);
}

/** The env-default value for `flag` (ignores any DB override). */
export function envFlagDefault(flag: string): boolean {
  const fn = RUNTIME_FLAG_DEFAULTS[flag];
  return fn ? fn() : false;
}

// Idempotently ensure the override table exists. Called lazily from the write
// path so a fresh env without the migration applied still works.
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.hermes_runtime_flags (
       flag text primary key,
       enabled boolean not null,
       updated_at timestamptz not null default now(),
       updated_by text
     )`,
  );
}

/**
 * Resolve a flag: DB override FIRST, else the env default. Never throws — any DB
 * failure falls back to the env default. With no DB, always the env default.
 */
export async function getRuntimeFlag(flag: string): Promise<boolean> {
  const def = envFlagDefault(flag);
  if (!hasDb) return def;
  try {
    const row = await q1<{ enabled: boolean }>(
      `select enabled from ops.hermes_runtime_flags where flag = $1`,
      [flag],
    );
    if (row && typeof row.enabled === 'boolean') return row.enabled;
    return def;
  } catch {
    // Table may not exist yet, or DB unreachable → env default.
    return def;
  }
}

/**
 * Convenience resolver for the PRIMARY Brain gate (HERMES_BRAIN_ENABLED): DB
 * override → env default. Use this at ASYNC boundaries (graph runPaTurn/resume,
 * knowledge Q&A, the live smoke checks) so an admin toggle from the Integrations
 * page takes effect with NO redeploy. With no DB it falls back to brainEnabled()
 * (the env default) — identical to the previous behaviour, so nothing breaks.
 */
export function brainEnabledRuntime(): Promise<boolean> {
  return getRuntimeFlag('HERMES_BRAIN_ENABLED');
}

export type RuntimeFlagState = {
  flag: string;
  enabled: boolean;
  envDefault: boolean;
  source: 'db' | 'env';
  updatedAt?: string;
  updatedBy?: string | null;
};

/**
 * Full resolved state for a flag (for the admin UI): the effective value, the env
 * default, whether a DB override is in force, and when/who last set it. Never
 * throws — degrades to the env default with source 'env'.
 */
export async function getRuntimeFlagState(flag: string): Promise<RuntimeFlagState> {
  const envDefault = envFlagDefault(flag);
  if (!hasDb) {
    return { flag, enabled: envDefault, envDefault, source: 'env' };
  }
  try {
    const row = await q1<{ enabled: boolean; updated_at: unknown; updated_by: string | null }>(
      `select enabled, updated_at, updated_by from ops.hermes_runtime_flags where flag = $1`,
      [flag],
    );
    if (row && typeof row.enabled === 'boolean') {
      const ua = row.updated_at;
      const updatedAt =
        ua instanceof Date ? ua.toISOString() : typeof ua === 'string' ? ua : undefined;
      return {
        flag,
        enabled: row.enabled,
        envDefault,
        source: 'db',
        updatedAt,
        updatedBy: row.updated_by,
      };
    }
    return { flag, enabled: envDefault, envDefault, source: 'env' };
  } catch {
    return { flag, enabled: envDefault, envDefault, source: 'env' };
  }
}

/**
 * Upsert a flag override. Requires a DB (mock-safe: returns a clear error when
 * there is none). `updatedBy` is the Clerk user id for the audit trail. Never
 * touches or stores any secret value.
 */
export async function setRuntimeFlag(
  flag: string,
  enabled: boolean,
  updatedBy?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isKnownFlag(flag)) {
    return { ok: false, error: `Unknown flag: ${flag}` };
  }
  if (!hasDb) {
    return {
      ok: false,
      error: 'No database in this environment — flag overrides require the ops DB.',
    };
  }
  try {
    await ensureTable();
    await q(
      `insert into ops.hermes_runtime_flags (flag, enabled, updated_at, updated_by)
       values ($1, $2, now(), $3)
       on conflict (flag) do update
         set enabled = excluded.enabled,
             updated_at = now(),
             updated_by = excluded.updated_by`,
      [flag, enabled, updatedBy ?? null],
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to set flag override' };
  }
}
