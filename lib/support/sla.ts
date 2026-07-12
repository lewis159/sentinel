// Sentinel support desk — SLA policy + timer maths.
//
// PURE + unit-testable: no DB, no server-only, no clock singletons. Everything
// derives from a ticket's own fields (priority, kind, status and either an
// explicit `slaDue` deadline or a created time / relative age), so it works
// identically in live mode and mock mode.
//
// The desk uses this to render an at-a-glance SLA badge (remaining time /
// "due soon" / "BREACHED") on the ticket list, the ticket detail header and the
// Needs-human queue, and to flag a breached OPEN ticket for the human queue.
//
// Additive: this is a NEW module. It does not change any existing query, the
// ops.tickets schema, or createTicket's signature — callers opt in.

import type { Severity, TicketKind } from '@/lib/mock';

// --------------------------------------------------------------------------
// Durations (all in milliseconds).
// --------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;

export type SlaTargets = {
  /** Time to first response. */
  responseMs: number;
  /** Time to resolution — the deadline the badge counts down to. */
  resolutionMs: number;
};

// Base targets by PRIORITY. Tighter for higher priority. Applied to incidents
// (factor 1.0); other kinds relax via KIND_FACTOR below.
const PRIORITY_TARGETS: Record<string, SlaTargets> = {
  critical: { responseMs: 15 * MIN, resolutionMs: 4 * HOUR },
  high:     { responseMs: 30 * MIN, resolutionMs: 8 * HOUR },
  medium:   { responseMs: 4 * HOUR, resolutionMs: 24 * HOUR },
  low:      { responseMs: 8 * HOUR, resolutionMs: 48 * HOUR },
  info:     { responseMs: 24 * HOUR, resolutionMs: 72 * HOUR },
};

// A sensible default when a ticket carries an unknown/blank priority.
const DEFAULT_PRIORITY: keyof typeof PRIORITY_TARGETS = 'medium';

// Per-KIND relaxation. Incidents and requests are customer-facing and keep the
// base clock; problems/changes/releases are internal engineering work with
// looser turnarounds, so their targets are stretched by these multipliers.
const KIND_FACTOR: Record<TicketKind, number> = {
  incident: 1,
  request: 1.5,
  problem: 2,
  change: 3,
  release: 3,
};

// Fraction of the resolution target remaining at/under which a ticket is
// "due soon" (amber). 0.25 → the final quarter of the window.
const DUE_SOON_FRACTION = 0.25;

// Statuses that mean the ticket is CLOSED — the SLA clock has stopped, so it can
// never be "breached" for operator-attention purposes.
const TERMINAL_STATUSES = new Set([
  'resolved', 'closed', 'fulfilled', 'cancelled', 'canceled',
  'implemented', 'done', 'completed',
]);

export type SlaState = 'ok' | 'due-soon' | 'breached';

/**
 * The response + resolution targets for a ticket's priority and kind.
 * `slaTargetFor('critical', 'incident')` → { responseMs, resolutionMs }.
 */
export function slaTargetFor(
  priority?: Severity | string | null,
  kind?: TicketKind | string | null,
): SlaTargets {
  const key = (priority ?? '').toString().toLowerCase();
  const base = PRIORITY_TARGETS[key] ?? PRIORITY_TARGETS[DEFAULT_PRIORITY];
  const factor = KIND_FACTOR[(kind ?? '') as TicketKind] ?? 1;
  return {
    responseMs: Math.round(base.responseMs * factor),
    resolutionMs: Math.round(base.resolutionMs * factor),
  };
}

// Minimal shape computeSla needs from a ticket. Compatible with both the mock
// `Ticket` (age + priority) and the `ServiceTicket` (slaDue + kind + status).
export type SlaTicket = {
  priority?: Severity | string | null;
  kind?: TicketKind | string | null;
  status?: string | null;
  /** Explicit resolution deadline (ISO). Takes precedence when present. */
  slaDue?: string | null;
  /** Absolute created time (ISO or Date) — used to derive a deadline. */
  createdAt?: string | Date | null;
  /** Relative age string ("just now", "40s", "3h", "2d") — last-resort fallback. */
  age?: string | null;
};

export type SlaResult = {
  /** Resolution deadline (ISO), or null when it cannot be determined. */
  dueAt: string | null;
  /** ms until the deadline; negative once breached. null when no deadline. */
  remainingMs: number | null;
  state: SlaState;
  /** True only for an OPEN ticket that is past its deadline. */
  breachedOpen: boolean;
};

// Parse a relative age string ("just now" | "40s" | "14m" | "3h" | "2d" | "1w")
// into milliseconds-in-the-past. Anything unparseable → 0 (treated as brand new).
function ageToMs(age: string | null | undefined): number {
  if (!age) return 0;
  if (/just now/i.test(age)) return 0;
  const m = age.match(/(\d+)\s*(s|m|h|d|w)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === 's' ? 1000 :
    unit === 'm' ? MIN :
    unit === 'h' ? HOUR :
    unit === 'd' ? 24 * HOUR :
    7 * 24 * HOUR;
  return n * mult;
}

function isTerminal(status?: string | null): boolean {
  return TERMINAL_STATUSES.has((status ?? '').toString().toLowerCase());
}

/**
 * Resolve a ticket's resolution deadline (ms since epoch) or null.
 * Prefers an explicit `slaDue`; otherwise derives created-time + policy target,
 * where created-time comes from `createdAt` or, failing that, `now - age`.
 */
function resolveDueMs(t: SlaTicket, now: number): number | null {
  if (t.slaDue) {
    const d = Date.parse(t.slaDue);
    if (!Number.isNaN(d)) return d;
  }
  const target = slaTargetFor(t.priority, t.kind).resolutionMs;
  if (t.createdAt) {
    const c = t.createdAt instanceof Date ? t.createdAt.getTime() : Date.parse(t.createdAt);
    if (!Number.isNaN(c)) return c + target;
  }
  if (t.age != null) {
    return (now - ageToMs(t.age)) + target;
  }
  return null;
}

/**
 * Compute a ticket's SLA state. `now` is injectable for deterministic tests.
 *
 * States (against the resolution deadline):
 *   - breached : remainingMs <= 0
 *   - due-soon : 0 < remainingMs <= DUE_SOON_FRACTION × resolution target
 *   - ok       : otherwise
 * A CLOSED (terminal-status) ticket never reports breached/due-soon — its clock
 * has stopped — so it always resolves to `ok`.
 */
export function computeSla(t: SlaTicket, now: number = Date.now()): SlaResult {
  const dueMs = resolveDueMs(t, now);
  if (dueMs == null) {
    return { dueAt: null, remainingMs: null, state: 'ok', breachedOpen: false };
  }

  const remainingMs = dueMs - now;
  const dueAt = new Date(dueMs).toISOString();
  const terminal = isTerminal(t.status);

  if (terminal) {
    // Clock stopped — no attention needed regardless of the deadline.
    return { dueAt, remainingMs, state: 'ok', breachedOpen: false };
  }

  const dueSoonWindow = slaTargetFor(t.priority, t.kind).resolutionMs * DUE_SOON_FRACTION;
  let state: SlaState;
  if (remainingMs <= 0) state = 'breached';
  else if (remainingMs <= dueSoonWindow) state = 'due-soon';
  else state = 'ok';

  return { dueAt, remainingMs, state, breachedOpen: state === 'breached' };
}

// --------------------------------------------------------------------------
// Presentation helpers (badge label + CSS class), so every surface renders the
// SLA identically. The desk's CSS already ships .ok/.warn/.breach variants for
// the `.v2-sup-sla` and `.v2-td-sla` badges — we reuse those class names.
// --------------------------------------------------------------------------

/** Map an SLA state → the existing badge CSS variant (ok | warn | breach). */
export function slaBadgeClass(state: SlaState): 'ok' | 'warn' | 'breach' {
  return state === 'breached' ? 'breach' : state === 'due-soon' ? 'warn' : 'ok';
}

/** Human "2h 5m" style duration from an absolute millisecond count. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const totalMin = Math.floor(abs / MIN);
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Short badge label: "3h 12m left" / "due soon" / "BREACHED 22m" / "no SLA". */
export function slaBadgeLabel(res: SlaResult): string {
  if (res.remainingMs == null) return 'no SLA';
  if (res.state === 'breached') return `BREACHED ${formatDuration(res.remainingMs)}`;
  const left = `${formatDuration(res.remainingMs)} left`;
  return res.state === 'due-soon' ? `due soon · ${left}` : left;
}
