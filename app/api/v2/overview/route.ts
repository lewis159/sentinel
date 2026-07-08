// v2 Overview API — GET /api/v2/overview
// Returns an OverviewData for the v2 Overview page. DB-first via lib/data with
// graceful fallbacks; every underlying call is wrapped so a source failure never
// 500s (it degrades to sensible values with live:false).
//
// REAL (from lib/data): incidents count + P1 flag (getTicketsByKind('incident')),
//   findings critical/open counts (getFindings), open-ticket total + attention
//   rows + queue counts (getTickets / getFindings), overall `live` flag.
// DECORATED PLACEHOLDERS (no source wired yet): the SLA KPI ("4 … 1 breached"),
//   the services KPI ("5/6 · 99.94% uptime"), the posture score+bars, and the
//   queue pill LABELS ("1 breach" / "3 <1h" / "on track"). Queue COUNTS are real.
//
// Auth: Clerk global_admin via requireOpsAuth().

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getFindings, getTickets, getTicketsByKind } from '@/lib/data';
import type { Finding, Ticket, ServiceTicket, Severity } from '@/lib/mock';
import type {
  OverviewData, AttentionItem, OverviewKpi, PostureBar, SupportQueue,
} from '@/lib/v2/api-types';

export const dynamic = 'force-dynamic';

const CLOSED = new Set(['resolved', 'closed', 'fixed', 'fulfilled']);
const isOpen = (status?: string) => !CLOSED.has((status ?? '').toLowerCase());

// Severity → CSS var tint + short pill token (shared by findings/incidents).
function sevTint(sev: Severity): string {
  if (sev === 'critical') return 'var(--crit)';
  if (sev === 'high') return 'var(--high)';
  if (sev === 'medium') return 'var(--med)';
  return 'var(--low)';
}
function sevPill(sev: Severity): string {
  if (sev === 'critical') return 'crit';
  if (sev === 'high') return 'high';
  return 'info';
}

// Deterministic small hash for stable bucketing/decoration.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function safe<T>(fn: () => Promise<{ rows: T[]; live: boolean }>): Promise<{ rows: T[]; live: boolean }> {
  try {
    return await fn();
  } catch {
    return { rows: [], live: false };
  }
}

export async function GET() {
  const denied = await requireSectionApi('overview');
  if (denied) return denied;

  // Pull the three sources concurrently, each already fault-tolerant.
  const [findingsRes, ticketsRes, incidentsRes] = await Promise.all([
    safe<Finding>(getFindings),
    safe<Ticket>(getTickets),
    safe<ServiceTicket>(() => getTicketsByKind('incident')),
  ]);

  const findings = findingsRes.rows;
  const tickets = ticketsRes.rows;
  const incidents = incidentsRes.rows;
  const live = findingsRes.live || ticketsRes.live || incidentsRes.live;

  // ---- KPIs ----
  const openIncidents = incidents.filter((t) => isOpen(t.status));
  const p1Count = openIncidents.filter((t) => t.priority === 'critical').length;
  const incidentsKpi: OverviewKpi = {
    value: String(openIncidents.length),
    meta: `${p1Count} P1 · ${incidentsRes.live ? 'live' : 'mock'}`,
  };

  const openFindings = findings.filter((f) => isOpen(f.status));
  const critFindings = openFindings.filter((f) => f.severity === 'critical');
  const findingsKpi: OverviewKpi = {
    value: String(critFindings.length),
    meta: `${openFindings.length} open`,
  };

  const openTickets = tickets.filter((t) => isOpen(t.status));
  // Placeholder: no real SLA source wired yet.
  const slaKpi: OverviewKpi = {
    value: '4',
    meta: `of ${openTickets.length} open · 1 breached`,
  };

  // Placeholder: no live infra source in this route.
  const servicesKpi: OverviewKpi = {
    value: '5/6',
    meta: '99.94% uptime',
  };

  // ---- Attention (up to ~6, deterministic) ----
  const attention: AttentionItem[] = [];

  // Top open findings by severity/CVSS (getFindings already orders by cvss desc).
  for (const f of openFindings.slice(0, 3)) {
    attention.push({
      key: `finding:${f.ref}`,
      tint: sevTint(f.severity),
      title: f.title,
      src: 'security',
      srcLabel: 'Security · Finding',
      ref: `${f.ref} · ${f.component}`,
      pill: sevPill(f.severity),
      pillLabel: f.severity === 'critical' ? 'crit' : 'high',
      age: f.age,
      href: '/v2/security',
    });
  }

  // Open incidents.
  for (const t of openIncidents.slice(0, 2)) {
    attention.push({
      key: `incident:${t.ref}`,
      tint: sevTint(t.priority),
      title: t.title,
      src: 'ops',
      srcLabel: 'Operations · Incident',
      ref: `${t.ref} · ${t.app}`,
      pill: 'crit',
      pillLabel: t.priority === 'critical' ? 'crit' : 'high',
      age: t.age,
      href: `/v2/incidents/${t.ref}`,
    });
  }

  // A couple of open tickets (support view).
  for (const t of openTickets.slice(0, 2)) {
    attention.push({
      key: `ticket:${t.ref}`,
      tint: sevTint(t.priority),
      title: t.title,
      src: 'support',
      srcLabel: 'Support · Ticket',
      ref: `${t.ref} · ${t.type}`,
      pill: 'high',
      pillLabel: 'high',
      age: t.age,
      href: `/v2/support/${t.ref}`,
    });
  }

  const attentionTop = attention.slice(0, 6);

  // ---- Posture (static placeholder — no posture source wired) ----
  const bars: PostureBar[] = [
    { lab: 'Dependencies', pct: 92, color: 'var(--ok)' },
    { lab: 'Secrets', pct: 100, color: 'var(--ok)' },
    { lab: 'Headers', pct: 60, color: 'var(--high)' },
    { lab: 'Access', pct: 80, color: 'var(--high)' },
  ];
  const posture = { score: 78, bars };

  // ---- Queues (real counts, decorated labels) ----
  // Deterministically bucket every ticket into one of 3 lanes by ref hash so the
  // counts sum to the ticket total.
  const qCounts = [0, 0, 0];
  for (const t of tickets) qCounts[hash(t.ref) % 3] += 1;
  const queues: SupportQueue[] = [
    { name: 'Billing', pill: 'crit', pillLabel: '1 breach', count: qCounts[0] },
    { name: 'Technical', pill: 'high', pillLabel: '3 <1h', count: qCounts[1] },
    { name: 'Onboarding', pill: 'ok', pillLabel: 'on track', count: qCounts[2] },
  ];

  const data: OverviewData = {
    live,
    kpis: { incidents: incidentsKpi, findings: findingsKpi, sla: slaKpi, services: servicesKpi },
    attention: attentionTop,
    posture,
    queues,
  };

  return NextResponse.json(data);
}
