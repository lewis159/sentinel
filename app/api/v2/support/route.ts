// v2 Support desk API — GET /api/v2/support
// Returns a SupportData: every ops ticket mapped to a SupportTicketRow for the
// v2 support desk table. DB-first via getTickets() with a mock fallback.
//
// REAL (from lib/data / getTickets): ref, title, priority, priorityPill, status,
//   owner (ticket.assignee), and the top-level `live` flag.
// DECORATED PLACEHOLDERS (no customer-support model exists yet): customer, plan,
//   sla, slaState, and the `linked` hint are DERIVED DETERMINISTICALLY from the
//   ticket ref (stable hash → fixed lists), so the table renders realistically
//   until a real support/CRM schema is wired in.
//
// Auth: Clerk global_admin via requireOpsAuth().

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getTickets } from '@/lib/data';
import type { SupportData, SupportTicketRow } from '@/lib/v2/api-types';

export const dynamic = 'force-dynamic';

// Deterministic small hash so decoration is stable across requests.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const CUSTOMERS = [
  { customer: 'Northwind Media', plan: 'Business' },
  { customer: 'Acme Studios', plan: 'Studio' },
  { customer: 'Kowalski Films', plan: 'Pro' },
  { customer: 'Bright Podcasts', plan: 'Starter' },
  { customer: 'Delta Learning', plan: 'Business' },
  { customer: 'Rosa Media Co', plan: 'Pro' },
];
const SLA_TEXT = ['3h 12m left', '48m left', 'breached 20m', '6h left', '1h 05m left'];
const SLA_STATE: Array<SupportTicketRow['slaState']> = ['ok', 'warn', 'breach'];

function priorityPill(priority: string): string {
  const p = priority.toLowerCase();
  if (p === 'critical') return 'crit';
  if (p === 'high') return 'high';
  return 'info';
}

export async function GET() {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  let live = false;
  let tickets: SupportTicketRow[] = [];

  try {
    const res = await getTickets();
    live = res.live;
    tickets = res.rows.map((t): SupportTicketRow => {
      const h = hash(t.ref);
      const cust = CUSTOMERS[h % CUSTOMERS.length];
      const slaState = SLA_STATE[h % SLA_STATE.length];
      const owner = t.assignee && t.assignee !== '—' ? t.assignee : 'Unassigned';
      const row: SupportTicketRow = {
        ref: t.ref,
        title: t.title,
        customer: cust.customer,
        plan: cust.plan,
        priority: t.priority,
        priorityPill: priorityPill(t.priority),
        status: t.status,
        sla: SLA_TEXT[h % SLA_TEXT.length],
        slaState,
        owner,
      };
      // Decorated cross-link hint for tickets sourced from a finding.
      if (t.finding) row.linked = `↳ ${t.finding}`;
      return row;
    });
  } catch {
    live = false;
    tickets = [];
  }

  const data: SupportData = { live, tickets };
  return NextResponse.json(data);
}
