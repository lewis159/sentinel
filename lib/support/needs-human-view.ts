// Sentinel support desk — the "Needs human" queue: SERVER assembler.
//
// Surfaces the tickets a human must pick up: those P2 intake flagged
// (attrs.needs_human) or the P3 ladder escalated to the human rung
// (escalation_level='human'). The canonical filter lives in
// getTicketsNeedingHuman() (lib/support/data.ts) — we call it read-only and
// enrich each ref with the full ITIL record (getServiceTicket) so the queue can
// show customer, priority, age and assignee. Pure ranking/labelling is in
// needs-human-sort.ts.
//
// Mock-safe: with no DATABASE_URL getTicketsNeedingHuman() returns []; we mirror
// how sibling pages degrade and derive the queue from the mock ITIL records
// (filtered by the same attrs contract), so the desk still renders in dev.
import 'server-only';
import { hasDb } from '@/lib/db';
import { getServiceTicket } from '@/lib/data';
import { serviceTickets as mockServiceTickets, type ServiceTicket } from '@/lib/mock';
import { getTicketsNeedingHuman } from './data';
import { toEscalationLevel } from './roles';
import { computeSla, slaBadgeClass, slaBadgeLabel } from './sla';
import {
  type NeedsHumanRow,
  ageToSeconds,
  priorityPill,
  reasonForNeedsHuman,
  sortByUrgency,
  urgencyScore,
} from './needs-human-sort';

export type { NeedsHumanRow } from './needs-human-sort';

// Is this open ticket past its SLA resolution deadline? A breach is a reason to
// pull a human in even when intake/ladder didn't flag it.
function slaBreached(t: ServiceTicket): boolean {
  return computeSla({
    priority: t.priority, kind: t.kind, status: t.status, slaDue: t.slaDue, age: t.age,
  }).breachedOpen;
}

// Does this ITIL record belong in the queue? (Same predicate the DB filter uses,
// PLUS a breached SLA on an open ticket — a breach demands human attention.)
function needsHuman(t: ServiceTicket): boolean {
  const a = t.attrs ?? {};
  return (
    a.needs_human === true ||
    String(a.needs_human) === 'true' ||
    a.escalation_level === 'human' ||
    slaBreached(t)
  );
}

// ServiceTicket → queue row.
function toRow(t: ServiceTicket): NeedsHumanRow {
  const attrs = t.attrs ?? {};
  const level = toEscalationLevel(attrs.escalation_level ?? 'human');
  const sla = computeSla({
    priority: t.priority, kind: t.kind, status: t.status, slaDue: t.slaDue, age: t.age,
  });
  // A breach becomes the row's reason when nothing else flagged it, so the
  // operator sees WHY it surfaced.
  const base = reasonForNeedsHuman(attrs, level);
  const flaggedByOther =
    attrs.needs_human === true || String(attrs.needs_human) === 'true' || level === 'human';
  const reason = sla.breachedOpen && !flaggedByOther ? 'SLA breached — past resolution deadline' : base.reason;
  const flaggedByIntake = base.flaggedByIntake;
  const ageSeconds = ageToSeconds(t.age);
  const customer = t.customerName || t.customerEmail || t.tenantRef || '—';
  const customerHref = t.tenantRef
    ? `/v2/support/customers/${encodeURIComponent(t.tenantRef)}`
    : t.customerEmail
      ? `/v2/support/customers/${encodeURIComponent(t.customerEmail)}`
      : null;
  const pill = priorityPill(t.priority);
  const assigneeId = t.assignee && t.assignee !== '—' ? t.assignee : '';
  return {
    ref: t.ref,
    title: t.title,
    customer,
    customerHref,
    reason,
    flaggedByIntake,
    level,
    priority: t.priority,
    priorityCls: pill.cls,
    priorityLabel: pill.label,
    age: t.age,
    ageSeconds,
    assigneeId,
    urgency: urgencyScore(t.priority, ageSeconds),
    slaClass: slaBadgeClass(sla.state),
    slaLabel: slaBadgeLabel(sla),
    slaBreached: sla.breachedOpen,
  };
}

// The queue, most-urgent first (priority, then age). `live` mirrors the sibling
// pages' Live/Mock badge.
export async function getNeedsHumanQueue(
  limit = 50,
): Promise<{ rows: NeedsHumanRow[]; live: boolean }> {
  // No DB → derive from the mock ITIL records so the desk still renders in dev.
  if (!hasDb) {
    const rows = mockServiceTickets.filter(needsHuman).slice(0, limit).map(toRow);
    return { rows: sortByUrgency(rows), live: false };
  }

  // DB path: the canonical filter gives us the refs; enrich each for the row.
  const flagged = await getTicketsNeedingHuman(limit);
  const rows: NeedsHumanRow[] = [];
  for (const f of flagged) {
    const { row } = await getServiceTicket(f.ref);
    if (row) {
      rows.push(toRow(row));
    } else {
      // Enrichment missed (e.g. ref outside ops.tickets): still surface a thin
      // row so nothing flagged is silently hidden from the human.
      rows.push(
        toRow({
          ref: f.ref,
          kind: 'incident',
          title: f.title,
          description: '',
          status: 'in_progress',
          priority: 'high',
          impact: '—',
          urgency: '—',
          app: 'Estate',
          assignee: '—',
          source: 'manual',
          slaDue: null,
          age: '—',
          tenantRef: null,
          customerEmail: null,
          customerName: null,
          attrs: { escalation_level: f.level, needs_human: true },
        } as ServiceTicket),
      );
    }
  }
  return { rows: sortByUrgency(rows), live: true };
}
