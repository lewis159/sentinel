// v2 Operations API — GET /api/v2/operations
// Returns an operations snapshot for the v2 Operations board. DB-first via
// lib/data with graceful fallbacks; every underlying call is wrapped so a source
// failure never 500s (it degrades to sensible values with live:false).
//
// REAL (from lib/data): the incidents list (getTicketsByKind('incident')) and
//   the tonight change window (getTicketsByKind('change')). The overall `live`
//   flag reflects whether either of those came from the real database.
// STATIC PLACEHOLDERS (no live infra source in this route): cpu, memory,
//   services, disk and uptime are plausible fixed values.
//
// Auth: Clerk global_admin via requireOpsAuth().

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getTicketsByKind } from '@/lib/data';
import type { ServiceTicket } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// ---- Response shape (defined inline here; not in api-types.ts) ----
type OpsService = { name: string; status: 'ok' | 'degraded' | 'down'; replicas: string; uptime: string };
type OpsIncident = { ref: string; priority: 'P1' | 'P2' | 'P3' | 'P4'; title: string; age: string };
type OpsChangeWindow = { ref: string; title: string; when: string } | null;
type OpsDisk = { mount: string; pct: number };

export type OperationsData = {
  live: boolean;
  cpu: { pct: number; samples: number[] };
  memory: { pct: number; samples: number[] };
  services: OpsService[];
  incidents: OpsIncident[];
  changeWindow: OpsChangeWindow;
  uptime: { pct: number; slo: number };
  disk: OpsDisk[];
};

const CLOSED = new Set(['resolved', 'closed', 'fixed', 'fulfilled', 'implemented']);
const isOpen = (status?: string) => !CLOSED.has((status ?? '').toLowerCase());

// Map a ticket Severity → an ITIL-style P-band for the incidents list.
function priorityBand(sev: string): OpsIncident['priority'] {
  if (sev === 'critical') return 'P1';
  if (sev === 'high') return 'P2';
  if (sev === 'medium') return 'P3';
  return 'P4';
}

async function safe(fn: () => Promise<{ rows: ServiceTicket[]; live: boolean }>): Promise<{ rows: ServiceTicket[]; live: boolean }> {
  try {
    return await fn();
  } catch {
    return { rows: [], live: false };
  }
}

export async function GET() {
  const denied = await requireSectionApi('operations');
  if (denied) return denied;

  // ---- Real: incidents + change window (each fault-tolerant) ----
  const [incidentsRes, changesRes] = await Promise.all([
    safe(() => getTicketsByKind('incident')),
    safe(() => getTicketsByKind('change')),
  ]);

  const live = incidentsRes.live || changesRes.live;

  const incidents: OpsIncident[] = incidentsRes.rows
    .filter((t) => isOpen(t.status))
    .slice(0, 5)
    .map((t) => ({
      ref: t.ref,
      priority: priorityBand(t.priority),
      title: t.title,
      age: t.age,
    }));

  // Tonight's change window: first open/upcoming change; prefer attrs.window for
  // the "when" label, falling back to the ticket age.
  const upcomingChange = changesRes.rows.find((t) => isOpen(t.status)) ?? changesRes.rows[0] ?? null;
  const changeWindow: OpsChangeWindow = upcomingChange
    ? {
        ref: upcomingChange.ref,
        title: upcomingChange.title,
        when: (upcomingChange.attrs?.window as string) || upcomingChange.age || 'TBD',
      }
    : null;

  // ---- Placeholders: no live infra source wired into this route ----
  const cpu = { pct: 34, samples: [28, 31, 26, 33, 38, 30, 35, 41, 34, 32, 36, 34] };
  const memory = { pct: 61, samples: [55, 57, 56, 59, 58, 60, 62, 61, 63, 60, 62, 61] };
  const services: OpsService[] = [
    { name: 'scribuo.com web', status: 'ok', replicas: '3/3', uptime: '99.99%' },
    { name: 'Transcription worker', status: 'degraded', replicas: '2/3', uptime: '99.71%' },
    { name: 'Postgres primary', status: 'ok', replicas: '1/1', uptime: '99.94%' },
    { name: 'Redis / queue', status: 'ok', replicas: '1/1', uptime: '100%' },
    { name: 'MinIO storage', status: 'ok', replicas: '2/2', uptime: '100%' },
  ];
  const uptime = { pct: 99.94, slo: 99.9 };
  const disk: OpsDisk[] = [
    { mount: '/', pct: 52 },
    { mount: '/var', pct: 87 },
    { mount: '/data', pct: 34 },
  ];

  const data: OperationsData = {
    live,
    cpu,
    memory,
    services,
    incidents,
    changeWindow,
    uptime,
    disk,
  };

  return NextResponse.json(data);
}
