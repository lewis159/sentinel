// The autonomy config store — the governance keystone.
//
// Holds, per (persona, tool), an effective autonomy MODE the Brain reads BEFORE
// running any tool, plus the numeric governance thresholds the settings page
// shows. Backed by the `hermes` schema (migration 12_hermes_autonomy.sql); this
// module also lazily creates the tables so prod never hard-depends on the
// migration having run first (same belt-and-braces pattern as config.ts).
//
//   auto        → the graph executes the tool immediately (read / safe).
//   gated       → the graph INTERRUPTS; a human approves it before it runs.
//   draft_only  → the agent may PROPOSE the call but even "safe" tools do NOT
//                 auto-execute — nothing runs; the proposed call is recorded.
//
// Runtime precedence (see graph.ts): DB row → persona.autonomyByTool → tool
// default. resolveAutonomy() applies the DB layer on top of the caller's static
// fallback, so flipping a dial in the UI changes gate behaviour with no redeploy.
import 'server-only';
import { hasDb, q } from '@/lib/db';

export type AutonomyMode = 'auto' | 'gated' | 'draft_only';

export type AutonomyToolRow = { persona: string; tool: string; mode: AutonomyMode };
export type AutonomyThresholdRow = { key: string; label: string; value: string };

export function isAutonomyMode(v: unknown): v is AutonomyMode {
  return v === 'auto' || v === 'gated' || v === 'draft_only';
}

// ---- Code-level defaults (used when the DB has no row / no DB at all). --------
// These mirror the migration seed AND the tools' own autonomy so behaviour is
// identical whether or not the DB has been seeded.
export const DEFAULT_TOOL_MODES: AutonomyToolRow[] = [
  { persona: 'pa', tool: 'getTicket', mode: 'auto' },
  { persona: 'pa', tool: 'listTickets', mode: 'auto' },
  { persona: 'pa', tool: 'getDeployStatus', mode: 'auto' },
  { persona: 'pa', tool: 'broadcastStatus', mode: 'auto' },
  { persona: 'pa', tool: 'updateTicket', mode: 'gated' },
  // The five department copilots: safe reads AUTO so an agentic copilot turn can
  // look things up on its own. Support additionally carries updateTicket as a
  // GATED action (interrupt → approval → execute once — the same spine as the PA).
  // The other four keep updateTicket draft_only defensively (it is not in their
  // allowedTools, so they cannot call it regardless).
  ...(['support', 'incident', 'escalation', 'billing', 'security'] as const).flatMap((p) =>
    (['getTicket', 'listTickets', 'getDeployStatus'] as const).map(
      (t): AutonomyToolRow => ({ persona: p, tool: t, mode: 'auto' }),
    ),
  ),
  { persona: 'support', tool: 'updateTicket', mode: 'gated' },
  ...(['incident', 'escalation', 'billing', 'security'] as const).map(
    (p): AutonomyToolRow => ({ persona: p, tool: 'updateTicket', mode: 'draft_only' }),
  ),
  // ---- P3 action tools (Stripe / Resend / GitHub) --------------------------
  // Reads are auto (safe lookups); every money/email/deploy WRITE is gated so the
  // graph interrupts for human approval before run() performs the side-effect.
  // Support: send the drafted reply (gated).
  { persona: 'support', tool: 'sendEmail', mode: 'gated' },
  // Billing (CFO): read a charge (auto); refund / credit / email (all gated).
  { persona: 'billing', tool: 'getCharge', mode: 'auto' },
  { persona: 'billing', tool: 'refundCharge', mode: 'gated' },
  { persona: 'billing', tool: 'issueCredit', mode: 'gated' },
  { persona: 'billing', tool: 'sendEmail', mode: 'gated' },
  // ---- Exec personas -------------------------------------------------------
  // CTO / Engineering: the GitHub deploy/commit path (moved here from incident).
  // Safe estate reads + GitHub reads AUTO; the two GitHub WRITES gated so they
  // interrupt for human approval before run() ships code / changes a repo.
  { persona: 'cto', tool: 'getTicket', mode: 'auto' },
  { persona: 'cto', tool: 'listTickets', mode: 'auto' },
  { persona: 'cto', tool: 'getDeployStatus', mode: 'auto' },
  { persona: 'cto', tool: 'listWorkflowRuns', mode: 'auto' },
  { persona: 'cto', tool: 'getFileContents', mode: 'auto' },
  { persona: 'cto', tool: 'triggerWorkflow', mode: 'gated' },
  { persona: 'cto', tool: 'commitFile', mode: 'gated' },
];

export const DEFAULT_THRESHOLDS: AutonomyThresholdRow[] = [
  { key: 'auto_refund_cap', label: 'Auto-refund cap', value: '£15' },
  { key: 'refund_cap_30d', label: 'Refund cap / customer / 30d', value: '£30' },
  { key: 'quota_bump_max', label: 'Quota bump max', value: '2× tier' },
  { key: 'bump_time_box', label: 'Bump time-box', value: '14 days' },
  { key: 'auto_actions_per_week', label: 'Auto-actions / customer / wk', value: '1' },
  { key: 'founder_sla', label: 'Founder approval SLA', value: '4 hrs' },
];

// Idempotently ensure the tables exist. Called lazily from every read/write path.
async function ensureTables(): Promise<void> {
  await q(`create schema if not exists hermes`);
  await q(
    `create table if not exists hermes.autonomy_config (
       persona    text not null,
       tool       text not null,
       mode       text not null default 'gated'
                    check (mode in ('auto','gated','draft_only')),
       updated_at timestamptz not null default now(),
       updated_by text,
       primary key (persona, tool)
     )`,
  );
  await q(
    `create table if not exists hermes.autonomy_thresholds (
       key        text primary key,
       label      text not null,
       value      text,
       sort       integer not null default 0,
       updated_at timestamptz not null default now(),
       updated_by text
     )`,
  );
}

// Read every override row into a `${persona}:${tool}` → mode map. Empty on any
// failure (no DB, table missing) so callers fall back to their static default.
async function loadOverrides(): Promise<Map<string, AutonomyMode>> {
  if (!hasDb) return new Map();
  try {
    await ensureTables();
    const rows = await q<{ persona: string; tool: string; mode: string }>(
      `select persona, tool, mode from hermes.autonomy_config`,
    );
    const m = new Map<string, AutonomyMode>();
    for (const r of rows) {
      if (isAutonomyMode(r.mode)) m.set(`${r.persona}:${r.tool}`, r.mode);
    }
    return m;
  } catch {
    return new Map();
  }
}

/**
 * Resolve the effective autonomy MODE for a (persona, tool). The DB override wins
 * over the caller's static `fallback` (persona override → tool default). This is
 * the single lookup the Brain's tool-gating path calls, so a dial flip in the UI
 * changes whether the tool interrupts for approval — no code change, no redeploy.
 */
export async function resolveAutonomy(
  persona: string,
  tool: string,
  fallback: AutonomyMode,
): Promise<AutonomyMode> {
  const overrides = await loadOverrides();
  return overrides.get(`${persona}:${tool}`) ?? fallback;
}

// ---- Read paths for the settings API ----------------------------------------

/**
 * Current per-(persona, tool) modes for the UI. Returns DB rows when present,
 * else the seeded code defaults so the page always shows sensible values.
 */
export async function getAutonomyTools(): Promise<AutonomyToolRow[]> {
  if (!hasDb) return DEFAULT_TOOL_MODES;
  try {
    await ensureTables();
    const rows = await q<{ persona: string; tool: string; mode: string }>(
      `select persona, tool, mode from hermes.autonomy_config order by persona, tool`,
    );
    const clean = rows.filter((r): r is AutonomyToolRow => isAutonomyMode(r.mode));
    return clean.length > 0 ? clean : DEFAULT_TOOL_MODES;
  } catch {
    return DEFAULT_TOOL_MODES;
  }
}

/** Current thresholds for the UI. DB rows when present, else code defaults. */
export async function getAutonomyThresholds(): Promise<AutonomyThresholdRow[]> {
  if (!hasDb) return DEFAULT_THRESHOLDS;
  try {
    await ensureTables();
    const rows = await q<{ key: string; label: string; value: string | null }>(
      `select key, label, value from hermes.autonomy_thresholds order by sort, key`,
    );
    if (rows.length === 0) return DEFAULT_THRESHOLDS;
    return rows.map((r) => ({ key: r.key, label: r.label, value: r.value ?? '' }));
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

// ---- Write path for the settings API ----------------------------------------

/**
 * Persist dial + threshold edits (admin only, gated at the API). Upserts each
 * provided (persona, tool) mode and each threshold value. Returns { ok } and is
 * a no-op error with no DB.
 */
export async function saveAutonomyConfig(input: {
  tools?: { persona: string; tool: string; mode: string }[];
  thresholds?: { key: string; value: string }[];
  by?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasDb) {
    return { ok: false, error: 'No database in this environment — cannot persist autonomy dials.' };
  }
  try {
    await ensureTables();
    const by = input.by ?? null;

    for (const t of input.tools ?? []) {
      if (!t || typeof t.persona !== 'string' || typeof t.tool !== 'string') continue;
      if (!isAutonomyMode(t.mode)) continue;
      await q(
        `insert into hermes.autonomy_config (persona, tool, mode, updated_at, updated_by)
         values ($1, $2, $3, now(), $4)
         on conflict (persona, tool)
         do update set mode = excluded.mode, updated_at = now(), updated_by = excluded.updated_by`,
        [t.persona, t.tool, t.mode, by],
      );
    }

    for (const th of input.thresholds ?? []) {
      if (!th || typeof th.key !== 'string') continue;
      const label = DEFAULT_THRESHOLDS.find((d) => d.key === th.key)?.label ?? th.key;
      await q(
        `insert into hermes.autonomy_thresholds (key, label, value, updated_at, updated_by)
         values ($1, $2, $3, now(), $4)
         on conflict (key)
         do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [th.key, label, String(th.value ?? ''), by],
      );
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to save autonomy config' };
  }
}
