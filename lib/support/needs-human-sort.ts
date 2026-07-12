// Sentinel support desk — the "Needs human" queue: PURE ordering + labelling
// helpers. No server-only, no DB, no heavy imports — just types and the
// priority/age → urgency maths and the reason labelling. Kept separate from the
// server assembler (needs-human-view.ts) so the ranking logic is unit-testable
// on its own and safe to import from either a client or a server component.

import type { Severity } from '@/lib/mock';
import type { EscalationLevel } from './roles';

// Higher = more urgent. `info` and anything unknown sort last.
export const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

// Parse the relative age strings the data layer produces (`rel()` → "just now",
// "14m", "3h", "2d"; mocks also carry "40s") into seconds, for the age tie-break.
// Anything unparseable ("—", "") sorts as brand-new (0s).
export function ageToSeconds(age: string | null | undefined): number {
  if (!age) return 0;
  if (/just now/i.test(age)) return 0;
  const m = age.match(/(\d+)\s*(s|m|h|d|w)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 604800;
  return n * mult;
}

// One number to sort by: priority dominates, age (older first) breaks ties.
// The 1e9 multiplier keeps priority strictly above any realistic age in seconds.
export function urgencyScore(priority: string, ageSeconds: number): number {
  return (PRIORITY_RANK[priority] ?? 0) * 1_000_000_000 + ageSeconds;
}

// Priority → pill class + label, matching the ticket detail page's mapping so
// the queue reads identically to the rest of the desk.
export function priorityPill(p: string): { cls: string; label: string } {
  switch (p) {
    case 'critical':
      return { cls: 'crit', label: 'Critical' };
    case 'high':
      return { cls: 'high', label: 'High' };
    case 'medium':
      return { cls: 'info', label: 'Medium' };
    case 'low':
      return { cls: 'info', label: 'Low' };
    default:
      return { cls: 'info', label: p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Normal' };
  }
}

// The reason a ticket is in this queue. Intake (P2) sets attrs.needs_human with
// attrs.escalated_via telling us WHY; the escalation ladder (P3) sets
// escalation_level='human'. We prefer the intake reason, then fall back to the
// escalation rung.
const VIA_REASON: Record<string, string> = {
  low_confidence: 'AI answer was low-confidence',
  unanswered: 'AI could not answer',
  customer: 'Customer asked for a human',
};

export function reasonForNeedsHuman(
  attrs: Record<string, any> | null | undefined,
  level: EscalationLevel,
): { reason: string; flaggedByIntake: boolean } {
  const a = attrs ?? {};
  const needsHuman = a.needs_human === true || String(a.needs_human) === 'true';
  if (needsHuman) {
    const via = typeof a.escalated_via === 'string' ? a.escalated_via : '';
    return { reason: VIA_REASON[via] ?? 'Flagged for a human by intake', flaggedByIntake: true };
  }
  if (level === 'human') return { reason: 'Escalated to the human gate', flaggedByIntake: false };
  return { reason: 'Needs a human', flaggedByIntake: false };
}

// A fully-assembled queue row (built by needs-human-view.ts from a ServiceTicket).
export type NeedsHumanRow = {
  ref: string;
  title: string;
  customer: string; // display label (name / email / tenant / "—")
  customerHref: string | null; // Customer-360 link when we have a real tenant/email
  reason: string; // why it landed in the queue
  flaggedByIntake: boolean; // true = AI intake flag, false = ladder escalation
  level: EscalationLevel;
  priority: Severity;
  priorityCls: string; // pill class
  priorityLabel: string;
  age: string; // display string
  ageSeconds: number;
  assigneeId: string; // raw clerk id ('' = unassigned)
  urgency: number; // sort key
};

// Most-urgent first: urgency desc, then ref for a stable order.
export function sortByUrgency<T extends { urgency: number; ref: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.urgency - a.urgency || a.ref.localeCompare(b.ref));
}
