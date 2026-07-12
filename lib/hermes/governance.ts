// Governance console read/write helpers — the single control surface's data
// layer. Powers app/v2/hermes/governance: the autonomy MATRIX (persona × tool
// dials, with each cell tagged code-default vs DB-override), the BUDGET CAPS
// editor (per persona/tool spend caps → ops.hermes_budgets), and the read side
// of escalation thresholds.
//
// This module OWNS the governance-specific reads/writes. It never edits the
// Brain hotspots — it imports the code-default matrix (DEFAULT_TOOL_MODES) and
// the mode guard (isAutonomyMode) from lib/hermes/brain/autonomy, and reads/
// writes ops.hermes_budgets directly (the same table lib/hermes/budget.ts meters
// against — we only add operator cap edits, never touch its runtime path).
//
// Mock-safe: with no DB, matrix reads fall back to code defaults and budget
// reads return an empty list; writes return { ok:false } with a clear message
// (same contract as saveAutonomyConfig).
import 'server-only';
import { hasDb, q, q1 } from '@/lib/db';
import {
  DEFAULT_TOOL_MODES,
  isAutonomyMode,
  type AutonomyMode,
} from '@/lib/hermes/brain/autonomy';

// ---------------------------------------------------------------------------
// Roster — the eight Hermes personas the console governs (PA + 5 copilots +
// CEO/Risk). Client-safe pure data; the human labels shown in the matrix + the
// budget editor's persona picker. CEO/Risk carry only the read-only estate
// lookups (all `auto`); they hold no side-effecting tool.
// ---------------------------------------------------------------------------
export type GovernancePersona = { id: string; label: string };

export const GOVERNANCE_PERSONAS: GovernancePersona[] = [
  { id: 'pa', label: 'PA · Personal Assistant' },
  { id: 'support', label: 'Support' },
  { id: 'incident', label: 'Incident response' },
  { id: 'escalation', label: 'Escalations' },
  { id: 'billing', label: 'Billing (CFO)' },
  { id: 'security', label: 'Security' },
  { id: 'ceo', label: 'CEO / Chief-of-Staff' },
  { id: 'risk', label: 'Risk / Red-team' },
];

const PERSONA_ORDER = GOVERNANCE_PERSONAS.map((p) => p.id);
const KNOWN_PERSONAS = new Set(PERSONA_ORDER);

// The read-only estate lookups the two execs (and every persona) may run auto.
const EXEC_READ_TOOLS = ['getTicket', 'listTickets', 'getDeployStatus'];

// The full CODE-DEFAULT matrix: DEFAULT_TOOL_MODES already encodes the effective
// per-(persona,tool) default for the PA + five copilots (it mirrors both the
// migration seed and each tool's own autonomy). CEO/Risk are not in it (they only
// ever read), so we append their read tools as `auto`.
function codeDefaultCells(): AutonomyToolCell[] {
  const cells: AutonomyToolCell[] = DEFAULT_TOOL_MODES.map((r) => ({
    persona: r.persona,
    tool: r.tool,
    defaultMode: r.mode,
  }));
  for (const persona of ['ceo', 'risk']) {
    for (const tool of EXEC_READ_TOOLS) {
      cells.push({ persona, tool, defaultMode: 'auto' });
    }
  }
  return cells;
}

type AutonomyToolCell = { persona: string; tool: string; defaultMode: AutonomyMode };

// A resolved matrix cell for the UI: the code default, the DB override (if any),
// the effective mode the Brain would use, and where that value came from.
export type AutonomyMatrixCell = {
  persona: string;
  tool: string;
  defaultMode: AutonomyMode;
  dbMode: AutonomyMode | null;
  mode: AutonomyMode; // effective = dbMode ?? defaultMode
  source: 'code' | 'db';
};

// Read every hermes.autonomy_config override into a `${persona}:${tool}` → mode
// map. Empty on any failure (no DB / table missing) so the matrix shows pure code
// defaults. Mirrors the private loadOverrides() in autonomy.ts (which we must not
// edit) — a plain SELECT, no DDL, so a missing table simply yields no overrides.
async function loadAutonomyOverrides(): Promise<Map<string, AutonomyMode>> {
  const m = new Map<string, AutonomyMode>();
  if (!hasDb) return m;
  try {
    const rows = await q<{ persona: string; tool: string; mode: string }>(
      `select persona, tool, mode from hermes.autonomy_config`,
    );
    for (const r of rows) {
      if (isAutonomyMode(r.mode)) m.set(`${r.persona}:${r.tool}`, r.mode);
    }
  } catch {
    /* table not created yet → no overrides, all cells are code defaults */
  }
  return m;
}

/**
 * The full autonomy matrix for the console: every roster (persona, tool) cell
 * with its code default, DB override, effective mode, and source. DB override
 * rows for combos not in the roster are appended so nothing configured is hidden.
 */
export async function getAutonomyMatrix(): Promise<AutonomyMatrixCell[]> {
  const overrides = await loadAutonomyOverrides();
  const seen = new Set<string>();
  const cells: AutonomyMatrixCell[] = [];

  for (const c of codeDefaultCells()) {
    const key = `${c.persona}:${c.tool}`;
    seen.add(key);
    const dbMode = overrides.get(key) ?? null;
    cells.push({
      persona: c.persona,
      tool: c.tool,
      defaultMode: c.defaultMode,
      dbMode,
      mode: dbMode ?? c.defaultMode,
      source: dbMode ? 'db' : 'code',
    });
  }

  // Any DB override not covered by the code roster (e.g. a tool added later) —
  // surface it so an operator can still see/adjust it. Its "default" is unknown,
  // so we show the DB value as both default and effective.
  for (const [key, mode] of overrides) {
    if (seen.has(key)) continue;
    const [persona, tool] = key.split(':');
    cells.push({ persona, tool, defaultMode: mode, dbMode: mode, mode, source: 'db' });
  }

  // Stable ordering: roster persona order, then tool name.
  cells.sort((a, b) => {
    const pa = PERSONA_ORDER.indexOf(a.persona);
    const pb = PERSONA_ORDER.indexOf(b.persona);
    if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    return a.tool.localeCompare(b.tool);
  });

  return cells;
}

// ---------------------------------------------------------------------------
// Budget caps — ops.hermes_budgets (the same table lib/hermes/budget.ts meters).
// A cap is (persona, tool, scope) → cap_minor over a rolling window_seconds. The
// console edits caps in MAJOR units (pounds); we convert to minor (pennies) on
// write and back on read. Current spend is read (best-effort) from the ledger.
// ---------------------------------------------------------------------------
export type BudgetWindow = { key: 'daily' | 'weekly'; label: string; seconds: number };

export const BUDGET_WINDOWS: BudgetWindow[] = [
  { key: 'daily', label: 'Daily', seconds: 86400 },
  { key: 'weekly', label: 'Weekly', seconds: 604800 },
];

export function windowLabelFor(seconds: number): string {
  return BUDGET_WINDOWS.find((w) => w.seconds === seconds)?.label ?? `${seconds}s`;
}

export type BudgetCapView = {
  persona: string;
  tool: string; // '*' = persona-wide
  scope: string;
  capMinor: number;
  capMajor: number; // capMinor / 100, for display/edit
  windowSeconds: number;
  windowLabel: string;
  spentMinor: number; // best-effort current spend inside the window (0 if unknown)
  remainingMinor: number;
  updatedAt: string | null;
};

type BudgetCapRow = {
  persona: string;
  tool: string;
  scope: string;
  cap_minor: string | number;
  window_seconds: number;
  updated_at: string | null;
};

/**
 * Current caps with (best-effort) windowed spend. Empty list with no DB. Spend is
 * summed from ops.hermes_budget_ledger for the cap's grain ('*' = all tools);
 * any failure just leaves spend at 0 so the cap still renders.
 */
export async function listBudgetCaps(): Promise<BudgetCapView[]> {
  if (!hasDb) return [];
  let rows: BudgetCapRow[] = [];
  try {
    rows = await q<BudgetCapRow>(
      `select persona, tool, scope, cap_minor, window_seconds, updated_at
         from ops.hermes_budgets
        order by persona, tool, scope`,
    );
  } catch {
    return [];
  }

  const views: BudgetCapView[] = [];
  for (const r of rows) {
    const capMinor = Number(r.cap_minor) || 0;
    const windowSeconds = Number(r.window_seconds) || 86400;
    let spentMinor = 0;
    try {
      const sql =
        r.tool === '*'
          ? `select coalesce(sum(amount_minor),0)::bigint as spent
               from ops.hermes_budget_ledger
              where persona = $1 and scope = $2
                and created_at >= now() - make_interval(secs => $3)`
          : `select coalesce(sum(amount_minor),0)::bigint as spent
               from ops.hermes_budget_ledger
              where persona = $1 and tool = $2 and scope = $3
                and created_at >= now() - make_interval(secs => $4)`;
      const params =
        r.tool === '*'
          ? [r.persona, r.scope, windowSeconds]
          : [r.persona, r.tool, r.scope, windowSeconds];
      const spentRow = await q1<{ spent: string | number }>(sql, params);
      spentMinor = Number(spentRow?.spent ?? 0) || 0;
    } catch {
      spentMinor = 0;
    }
    views.push({
      persona: r.persona,
      tool: r.tool,
      scope: r.scope,
      capMinor,
      capMajor: capMinor / 100,
      windowSeconds,
      windowLabel: windowLabelFor(windowSeconds),
      spentMinor,
      remainingMinor: capMinor - spentMinor,
      updatedAt: r.updated_at,
    });
  }
  return views;
}

// ---- Budget cap write path --------------------------------------------------

export type BudgetUpsertInput = {
  persona: string;
  tool?: string; // default '*'
  scope?: string; // default 'global'
  capMajor: number; // major units (pounds) — converted to minor on write
  windowSeconds: number; // must be > 0 (UI sends a BUDGET_WINDOWS value)
  by?: string;
};

export type BudgetUpsertResult = {
  ok: boolean;
  error?: string;
  cap?: { persona: string; tool: string; scope: string; capMinor: number; windowSeconds: number };
};

// Convert a MAJOR-unit amount (pounds, possibly fractional) to whole MINOR units
// (pennies). Rounds to the nearest penny; clamps negatives to 0.
export function toMinorUnits(major: number): number {
  if (!Number.isFinite(major)) return 0;
  return Math.max(0, Math.round(major * 100));
}

/**
 * Validate + upsert a budget cap. Pure validation (persona in the roster, finite
 * non-negative cap, positive window) then an ON CONFLICT upsert keyed by the
 * table's (persona, tool, scope) PK. No DB → { ok:false } with a clear message
 * (never throws for a missing DB, matching saveAutonomyConfig).
 */
export async function upsertBudgetCap(input: BudgetUpsertInput): Promise<BudgetUpsertResult> {
  const persona = typeof input.persona === 'string' ? input.persona.trim() : '';
  const tool = typeof input.tool === 'string' && input.tool.trim() ? input.tool.trim() : '*';
  const scope = typeof input.scope === 'string' && input.scope.trim() ? input.scope.trim() : 'global';

  if (!persona) return { ok: false, error: 'persona is required' };
  if (!KNOWN_PERSONAS.has(persona)) return { ok: false, error: `unknown persona "${persona}"` };
  if (typeof input.capMajor !== 'number' || !Number.isFinite(input.capMajor) || input.capMajor < 0) {
    return { ok: false, error: 'cap must be a non-negative number' };
  }
  if (
    typeof input.windowSeconds !== 'number' ||
    !Number.isFinite(input.windowSeconds) ||
    input.windowSeconds <= 0
  ) {
    return { ok: false, error: 'window must be a positive number of seconds' };
  }

  const capMinor = toMinorUnits(input.capMajor);
  const windowSeconds = Math.trunc(input.windowSeconds);

  if (!hasDb) {
    return { ok: false, error: 'No database in this environment — cannot persist budget caps.' };
  }

  try {
    await q(
      `insert into ops.hermes_budgets (persona, tool, scope, cap_minor, window_seconds, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, now(), $6)
       on conflict (persona, tool, scope)
       do update set cap_minor = excluded.cap_minor,
                     window_seconds = excluded.window_seconds,
                     updated_at = now(),
                     updated_by = excluded.updated_by`,
      [persona, tool, scope, capMinor, windowSeconds, input.by ?? null],
    );
    return { ok: true, cap: { persona, tool, scope, capMinor, windowSeconds } };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to save budget cap' };
  }
}
