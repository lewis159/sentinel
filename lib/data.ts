// Data access for Sentinel. Reads Sentinel's OWN local Postgres (the `ops`
// schema) for its own entities via the `q`/`q1` helpers, and pulls real YT
// Transcriber data (users/videos) through the configurable Supabase connector.
// Every function falls back to mock data when the DB is unreachable or empty,
// so the prototype always renders. Each returns { rows, live } — `live` true
// means the data came from the real database.

import { hasDb, q, q1 } from './db';
import { getSupabase } from './connectors';
import { getContainers } from './docker';
import * as mock from './mock';
import { KIND_STATUSES } from './mock';
import type {
  Finding, Ticket, AbuseUser, Severity,
  ServiceTicket, TicketKind, RoadmapItem, ChangelogEntry,
} from './mock';

export type Sourced<T> = { rows: T[]; live: boolean; note?: string };

function rel(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function mapFinding(r: any): Finding {
  return {
    ref: r.ref, title: r.title, desc: r.description ?? '', severity: (r.severity ?? 'medium') as Severity,
    cvss: Number(r.cvss) || 0, cwe: r.cwe ?? '', component: r.component_label ?? '—',
    source: r.source ?? 'manual', status: r.status ?? 'open', age: rel(r.last_seen_at ?? r.first_seen_at),
  };
}

function mapTicket(r: any): Ticket {
  return {
    ref: r.ref, title: r.title, type: r.type ?? 'task', status: r.status ?? 'open',
    priority: (r.priority ?? 'medium') as Severity, assignee: '—', source: r.source ?? 'manual',
    age: rel(r.opened_at ?? r.created_at),
  };
}

// ---------- Findings (ops.findings) ----------
export async function getFindings(): Promise<Sourced<Finding>> {
  if (!hasDb) return { rows: mock.findings, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select ref,title,description,severity,cvss,cwe,component_label,source,status,last_seen_at,first_seen_at from ops.findings order by cvss desc nulls last'
    );
    if (data.length === 0) return { rows: mock.findings, live: false, note: 'empty' };
    return { rows: data.map(mapFinding), live: true };
  } catch (e: any) {
    return { rows: mock.findings, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Tickets (ops.tickets) ----------
export async function getTickets(): Promise<Sourced<Ticket>> {
  if (!hasDb) return { rows: mock.tickets, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select ref,title,type,status,priority,source,opened_at,created_at from ops.tickets order by opened_at desc nulls last'
    );
    if (data.length === 0) return { rows: mock.tickets, live: false, note: 'empty' };
    return { rows: data.map(mapTicket), live: true };
  } catch (e: any) {
    return { rows: mock.tickets, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Alerts (ops.alerts) ----------
export type Alert = {
  id: string; severity: Severity; message: string; rule: string; status: string; when: string;
};

export async function getAlerts(): Promise<Sourced<Alert>> {
  if (!hasDb) return { rows: mock.alerts as Alert[], live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select id,rule_id,severity,message,status,fired_at from ops.alerts order by fired_at desc'
    );
    if (data.length === 0) return { rows: mock.alerts as Alert[], live: false, note: 'empty' };
    const rows: Alert[] = data.map((r) => ({
      id: String(r.id),
      severity: (r.severity ?? 'medium') as Severity,
      message: r.message ?? '',
      rule: r.rule_id ?? r.message ?? '—',
      status: r.status ?? 'firing',
      when: rel(r.fired_at),
    }));
    return { rows, live: true };
  } catch (e: any) {
    return { rows: mock.alerts as Alert[], live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Check catalogue with live finding counts (ops.findings) ----------
export async function getCheckStats(): Promise<{ rows: mock.Check[]; live: boolean; note?: string }> {
  if (!hasDb) return { rows: mock.checks, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      "select source, count(*)::int as n from ops.findings where status<>'fixed' group by source"
    );
    if (data.length === 0) return { rows: mock.checks, live: false, note: 'empty' };
    const bySource = new Map<string, number>(data.map((r) => [r.source, Number(r.n) || 0]));
    const rows: mock.Check[] = mock.checks.map((c) => {
      const n = bySource.get(c.source) ?? 0;
      return { ...c, findings: n, status: n > 0 ? 'issues' : 'pass' };
    });
    return { rows, live: true };
  } catch (e: any) {
    return { rows: mock.checks, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Scan/worker runs (ops.jobs) ----------
export type ScanRun = {
  id: string; type: string; findings: string; status: string; when: string; duration: string;
};

export async function getScanRuns(limit = 20): Promise<Sourced<ScanRun>> {
  if (!hasDb) return { rows: mock.scanRuns as ScanRun[], live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select id,type,status,attempts,updated_at,last_error from ops.jobs order by updated_at desc limit $1',
      [limit]
    );
    if (data.length === 0) return { rows: mock.scanRuns as ScanRun[], live: false, note: 'empty' };
    const rows: ScanRun[] = data.map((r) => ({
      id: String(r.id).slice(0, 8),
      type: r.type ?? '—',
      findings: r.last_error ? 'failed' : (r.attempts != null ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : r.status ?? '—'),
      status: r.status ?? '—',
      when: rel(r.updated_at),
      duration: '—',
    }));
    return { rows, live: true };
  } catch (e: any) {
    return { rows: mock.scanRuns as ScanRun[], live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Single finding (ops.findings) ----------
export async function getOneFinding(ref: string): Promise<{ row: Finding | null; live: boolean }> {
  const fallback = () => mock.findings.find((f) => f.ref === ref) ?? null;
  if (!hasDb) return { row: fallback(), live: false };
  try {
    const data = await q1<any>(
      'select ref,title,description,severity,cvss,cwe,component_label,source,status,last_seen_at,first_seen_at from ops.findings where ref=$1',
      [ref]
    );
    if (!data) return { row: fallback(), live: false };
    return { row: mapFinding(data), live: true };
  } catch {
    return { row: fallback(), live: false };
  }
}

// ---------- Single ticket (ops.tickets) ----------
export async function getOneTicket(ref: string): Promise<{ row: Ticket | null; live: boolean }> {
  const fallback = () => mock.tickets.find((t) => t.ref === ref) ?? null;
  if (!hasDb) return { row: fallback(), live: false };
  try {
    const data = await q1<any>(
      'select ref,title,type,status,priority,source,opened_at,created_at from ops.tickets where ref=$1',
      [ref]
    );
    if (!data) return { row: fallback(), live: false };
    return { row: mapTicket(data), live: true };
  } catch {
    return { row: fallback(), live: false };
  }
}

// ---------- Components (ops.components) — hybrid derive-then-curate ----------
// Components are the spine that links findings to the containers they run on.
// They're auto-DERIVED from live container/service name prefixes (mapContainer
// logic: name.split(/[_.]/)[0]) and then CURATED — operators can rename/merge.
// Reads are DB-first with a mock fallback so the page always renders.

export type ComponentRow = {
  key: string;
  name: string;
  kind: string;
  findings: number;
  containers: number;
};

// Map a mock component shape (already has findings/containers) through unchanged.
function mockComponents(): ComponentRow[] {
  return (mock.components as any[]).map((c) => ({
    key: c.key, name: c.name, kind: c.kind,
    findings: Number(c.findings) || 0, containers: Number(c.containers) || 0,
  }));
}

// All components with live finding + container counts. DB-first: reads
// ops.components, left-joins finding counts (by component_label = key) and the
// runs_on edge count for container totals. Falls back to mock when no DB / empty.
export async function getComponents(): Promise<Sourced<ComponentRow>> {
  if (!hasDb) return { rows: mockComponents(), live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      `select c.key, c.name, c.kind,
              coalesce(f.n, 0)::int as findings,
              coalesce(l.n, 0)::int as containers
         from ops.components c
         left join (
           select component_label as k, count(*) as n
             from ops.findings
            where status <> 'fixed' and component_label is not null
            group by component_label
         ) f on f.k = c.key
         left join (
           select src_id as k, count(*) as n
             from ops.links
            where src_type = 'component' and dst_type = 'container' and relation = 'runs_on'
            group by src_id
         ) l on l.k = c.key
        order by c.key asc`
    );
    if (data.length === 0) return { rows: mockComponents(), live: false, note: 'empty' };
    return {
      rows: data.map((r) => ({
        key: r.key, name: r.name, kind: r.kind ?? 'service',
        findings: Number(r.findings) || 0, containers: Number(r.containers) || 0,
      })),
      live: true,
    };
  } catch (e: any) {
    return { rows: mockComponents(), live: false, note: e?.message ?? 'error' };
  }
}

// Single component by key. DB-first with the same enriched counts; mock fallback.
export async function getOneComponent(key: string): Promise<{ row: ComponentRow | null; live: boolean }> {
  const fallback = () => mockComponents().find((c) => c.key === key) ?? null;
  if (!hasDb) return { row: fallback(), live: false };
  try {
    const data = await q1<any>(
      `select c.key, c.name, c.kind,
              (select count(*) from ops.findings
                where component_label = c.key and status <> 'fixed')::int as findings,
              (select count(*) from ops.links
                where src_type = 'component' and src_id = c.key
                  and dst_type = 'container' and relation = 'runs_on')::int as containers
         from ops.components c
        where c.key = $1`,
      [key]
    );
    if (!data) return { row: fallback(), live: false };
    return {
      row: {
        key: data.key, name: data.name, kind: data.kind ?? 'service',
        findings: Number(data.findings) || 0, containers: Number(data.containers) || 0,
      },
      live: true,
    };
  } catch {
    return { row: fallback(), live: false };
  }
}

// Upsert a component by key (idempotent). Used by the ingest auto-link path and
// the topology reconcile. Only sets name on first insert; an operator rename
// (curate side of "derive-then-curate") is preserved on conflict.
export async function upsertComponent(key: string, name?: string, kind = 'service'): Promise<void> {
  if (!hasDb) return;
  await q(
    `insert into ops.components (key, name, kind)
       values ($1, $2, $3)
     on conflict (key) do nothing`,
    [key, name ?? key, kind]
  );
}

// Reconcile ops.components + component→container edges from live topology. For
// every live container, derive its component prefix (mapContainer logic),
// upsert the component, and write an idempotent component --runs_on--> container
// edge tagged created_by='auto:rule'. Returns counts; no-ops gracefully when
// there's no DB or no live docker. Safe to call from a reconcile job or on-read.
export async function reconcileComponentsFromTopology(): Promise<{ components: number; edges: number; live: boolean }> {
  if (!hasDb) return { components: 0, edges: 0, live: false };
  try {
    const { rows: containers, live } = await getContainers();
    if (!live) return { components: 0, edges: 0, live: false };
    const seen = new Set<string>();
    let edges = 0;
    for (const c of containers) {
      const key = c.component || c.name;
      if (!key) continue;
      if (!seen.has(key)) {
        await upsertComponent(key, key, 'service');
        seen.add(key);
      }
      await q(
        `insert into ops.links (src_type, src_id, dst_type, dst_id, relation, created_by)
           values ('component', $1, 'container', $2, 'runs_on', 'auto:rule')
         on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
        [key, c.name]
      );
      edges += 1;
    }
    return { components: seen.size, edges, live: true };
  } catch {
    return { components: 0, edges: 0, live: false };
  }
}

// ---------- Finding graph edges (ops.links, both directions) ----------
export type Edge = { rel: string; type: string; id: string; label: string; href: string };

function hrefFor(type: string, id: string): string {
  switch (type) {
    case 'ticket': return `/tickets/${id}`;
    case 'component': return `/components/${encodeURIComponent(id)}`;
    case 'kb': return `/kb/${id}`;
    case 'finding': return `/findings/${id}`;
    case 'container': return `/infra/${encodeURIComponent(id)}`;
    case 'scan': return `/scans/runs/${id}`;
    default: return '#';
  }
}

// Generic edge reader — generalises getFindingEdges / getTicketEdges to any node
// type. Returns every ops.links row where (type,id) is on either side, mapped to
// the "other" node as an Edge. DB-only; [] on no-DB / error.
export async function getEdges(type: string, id: string): Promise<Edge[]> {
  if (!hasDb) return [];
  try {
    const rows = await q<any>(
      `select relation, src_type, src_id, dst_type, dst_id from ops.links
        where (src_type = $1 and src_id = $2) or (dst_type = $1 and dst_id = $2)`,
      [type, id]
    );
    return rows.map((l: any) => {
      const isSrc = l.src_type === type && l.src_id === id;
      const otherType = isSrc ? l.dst_type : l.src_type;
      const otherId = isSrc ? l.dst_id : l.src_id;
      return { rel: l.relation ?? 'linked', type: otherType, id: otherId, label: otherId, href: hrefFor(otherType, otherId) };
    });
  } catch {
    return [];
  }
}

export async function getFindingEdges(ref: string): Promise<Edge[]> {
  const fallback = (): Edge[] => mock.findingLinks[ref] ?? [];
  if (!hasDb) return fallback();
  const edges = await getEdges('finding', ref);
  // Keep the mock fallback when there are no real edges yet (prototype always
  // renders something on the canonical SEC-0009 demo finding).
  return edges.length === 0 ? fallback() : edges;
}

// ---------- Ticket graph edges (ops.links, both directions) ----------
// Linked records for one ITIL ticket: any ops.links row where this ticket's ref
// is on the src or dst side. Returns the "other" node as an Edge. DB-only — if
// there's no DB or no rows, the UI shows a "No linked records" state.
export async function getTicketEdges(ref: string): Promise<Edge[]> {
  return getEdges('ticket', ref);
}

// ---------- Per-user saved layouts (ops.user_layouts) ----------
export async function getUserLayout(clerkUserId: string, layoutKey: string): Promise<any | null> {
  if (!hasDb) return null;
  try {
    const row = await q1<{ layout: any }>(
      'select layout from ops.user_layouts where clerk_user_id=$1 and layout_key=$2',
      [clerkUserId, layoutKey]
    );
    return row?.layout ?? null;
  } catch {
    return null;
  }
}

export async function saveUserLayout(clerkUserId: string, layoutKey: string, layout: any): Promise<boolean> {
  if (!hasDb) return false;
  try {
    await q(
      `insert into ops.user_layouts (clerk_user_id, layout_key, layout)
         values ($1, $2, $3::jsonb)
       on conflict (clerk_user_id, layout_key)
         do update set layout = excluded.layout, updated_at = now()`,
      [clerkUserId, layoutKey, JSON.stringify(layout ?? {})]
    );
    return true;
  } catch {
    return false;
  }
}

// ---------- Writes (server-only) ----------
export async function raiseTicketFromFinding(findingRef: string): Promise<{ ref: string }> {
  if (!hasDb) throw new Error('no DB');
  const { row: finding } = await getOneFinding(findingRef);
  if (!finding) throw new Error(`finding ${findingRef} not found`);
  const priority = finding.severity === 'info' ? 'low' : finding.severity;
  const ticket = await q1<{ ref: string }>(
    "insert into ops.tickets (title,type,priority,status,source) values ($1,'security',$2,'open','finding') returning ref",
    [`Remediate ${finding.title}`, priority]
  );
  if (!ticket) throw new Error('insert failed');
  const newRef = ticket.ref;
  await q(
    `insert into ops.links (src_type,src_id,dst_type,dst_id,relation,created_by)
       values ('finding',$1,'ticket',$2,'raises','auto:rule')
     on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
    [findingRef, newRef]
  );
  return { ref: newRef };
}

export async function updateFindingStatus(ref: string, status: string): Promise<void> {
  if (!hasDb) throw new Error('no DB');
  await q('update ops.findings set status=$2, override_locked=true where ref=$1', [ref, status]);
}

// ---------- Resilience self-tests (ops.resilience_runs) ----------
export type ResilienceCheck = {
  key: string;
  name: string;
  kind: 'resilience' | 'security' | 'scalability';
  desc: string;
};

// Static catalogue of the 5 self-test suites the runner can execute.
export const RESILIENCE_CHECKS: ResilienceCheck[] = [
  {
    key: 'db-failover',
    name: 'Database failover',
    kind: 'resilience',
    desc: 'Kills the primary Postgres container and verifies Patroni promotes a replica and writes recover.',
  },
  {
    key: 'app-replica',
    name: 'App replica resilience',
    kind: 'resilience',
    desc: 'Kills an app container and confirms the load balancer reroutes traffic to healthy replicas with no downtime.',
  },
  {
    key: 'worker',
    name: 'Worker recovery',
    kind: 'resilience',
    desc: 'Kills a background worker mid-job and verifies the job is retried and the worker is respawned.',
  },
  {
    key: 'headers',
    name: 'Security headers',
    kind: 'security',
    desc: 'Probes responses for HSTS, CSP, X-Frame-Options and related hardening headers.',
  },
  {
    key: 'scale',
    name: 'Horizontal scale-out',
    kind: 'scalability',
    desc: 'Drives concurrent load and verifies replicas scale out and latency stays within budget.',
  },
];

export type ResilienceRun = {
  id: number;
  suite: string;
  passed: boolean;
  results: Record<string, { passed: boolean; detail: string }>;
  duration_ms: number;
  ran_at: string;
};

const mockResilienceRuns: ResilienceRun[] = [
  {
    id: 412, suite: 'all', passed: true,
    results: {
      'db-failover': { passed: true, detail: 'Replica promoted in 7.2s; writes resumed' },
      'app-replica': { passed: true, detail: 'Traffic rerouted, 0 failed requests' },
      'worker': { passed: true, detail: 'Job re-queued and completed' },
      'headers': { passed: true, detail: 'All required headers present' },
      'scale': { passed: true, detail: 'Scaled 2→5 replicas, p95 480ms' },
    },
    duration_ms: 184200, ran_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  },
  {
    id: 411, suite: 'headers', passed: false,
    results: {
      'headers': { passed: false, detail: 'Missing Content-Security-Policy on /api/*' },
    },
    duration_ms: 1400, ran_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
  },
  {
    id: 410, suite: 'db-failover', passed: true,
    results: {
      'db-failover': { passed: true, detail: 'Replica promoted in 6.8s; writes resumed' },
    },
    duration_ms: 41900, ran_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  },
];

export async function getResilienceRuns(limit = 20): Promise<Sourced<ResilienceRun>> {
  if (!hasDb) return { rows: mockResilienceRuns, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select id,suite,passed,results,duration_ms,ran_at from ops.resilience_runs order by ran_at desc limit $1',
      [limit]
    );
    if (data.length === 0) return { rows: mockResilienceRuns, live: false, note: 'empty' };
    const rows: ResilienceRun[] = data.map((r) => ({
      id: r.id,
      suite: r.suite,
      passed: Boolean(r.passed),
      results: (typeof r.results === 'string' ? JSON.parse(r.results) : r.results) ?? {},
      duration_ms: Number(r.duration_ms) || 0,
      ran_at: r.ran_at instanceof Date ? r.ran_at.toISOString() : r.ran_at,
    }));
    return { rows, live: true };
  } catch (e: any) {
    return { rows: mockResilienceRuns, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Real users (via Supabase connector → public.users) ----------
const DISPOSABLE = ['tempmail', 'guerrillamail', 'mailinator', '10minutemail', 'throwaway', 'yopmail'];

export async function getUsers(): Promise<Sourced<AbuseUser>> {
  const sb = await getSupabase();
  if (!sb) return { rows: mock.users, live: false, note: 'no connector' };
  const { data, error } = await sb
    .from('users')
    .select('id,email,tier,created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { rows: mock.users, live: false, note: error.message };
  if (!data || data.length === 0) return { rows: mock.users, live: false, note: 'no users' };
  const rows: AbuseUser[] = data.map((u: any) => {
    const email: string = u.email ?? '';
    const domain = email.split('@')[1] ?? '';
    const disposable = DISPOSABLE.some((d) => domain.includes(d));
    const fresh = u.created_at && Date.now() - new Date(u.created_at).getTime() < 24 * 3600 * 1000;
    const signals: string[] = [];
    if (disposable) signals.push('Disposable email');
    if (fresh) signals.push('New account (<24h)');
    const risk = (disposable ? 60 : 0) + (fresh ? 25 : 0) + 10;
    return {
      id: u.id, name: email.split('@')[0] || 'user', email, tier: u.tier ?? '—',
      risk: Math.min(risk, 99), signals, lastSeen: rel(u.created_at),
    };
  });
  return { rows, live: true };
}

// ---------- Real platform stats (via Supabase connector — the system monitored) ----------
export async function getPlatformStats(): Promise<{ users: number; videos: number; transcripts: number; live: boolean }> {
  const sb = await getSupabase();
  if (!sb) return { users: 3, videos: 12, transcripts: 4, live: false };
  const [u, v, t] = await Promise.all([
    sb.from('users').select('*', { count: 'exact', head: true }),
    sb.from('videos').select('*', { count: 'exact', head: true }),
    sb.from('transcripts').select('*', { count: 'exact', head: true }),
  ]);
  return {
    users: u.count ?? 0, videos: v.count ?? 0, transcripts: t.count ?? 0,
    live: !u.error && !v.error,
  };
}

// ---------- Service management (ITIL) — ops.tickets extended ----------
function mapServiceTicket(r: any): ServiceTicket {
  const attrs = (typeof r.attrs === 'string' ? safeJson(r.attrs) : r.attrs) ?? {};
  return {
    ref: r.ref,
    kind: (r.kind ?? 'incident') as TicketKind,
    title: r.title,
    description: r.description ?? '',
    status: r.status ?? 'open',
    priority: (r.priority ?? 'medium') as Severity,
    impact: r.impact ?? '—',
    urgency: r.urgency ?? '—',
    app: r.app ?? 'Estate',
    // P3 — prefer the first-class assignee column, falling back to the attrs
    // contract for rows written before the column existed (read-through).
    assignee: r.assignee ?? attrs.assignee ?? '—',
    assignedAt: r.assigned_at
      ? (r.assigned_at instanceof Date ? r.assigned_at.toISOString() : r.assigned_at)
      : null,
    source: r.source ?? 'manual',
    slaDue: r.sla_due ? (r.sla_due instanceof Date ? r.sla_due.toISOString() : r.sla_due) : null,
    age: rel(r.opened_at ?? r.created_at),
    // P2 multi-tenancy — read the first-class column, falling back to the attrs
    // value (the shared contract with the intake agent) so rows written by
    // intake-only (before the column backfill) still resolve their tenant.
    tenantRef: r.tenant_ref ?? attrs.tenant_ref ?? null,
    customerEmail: r.customer_email ?? attrs.customer_email ?? null,
    customerName: r.customer_name ?? attrs.customer_name ?? null,
    attrs,
  };
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

const TICKET_COLS =
  'ref,kind,title,description,status,priority,impact,urgency,app,source,sla_due,opened_at,created_at,tenant_ref,customer_email,customer_name,assignee,assigned_at,attrs';

// All ITIL records of a given kind (incident|request|change|problem|release).
//
// P2 tenant scoping: pass `opts.tenantRef` to restrict results to a single
// tenant (a Clerk org id → ops.tickets.tenant_ref). This is ADDITIVE — operators
// (global_admin) call it with no tenantRef and see every ticket unchanged; a
// per-tenant / customer-facing surface passes the caller's resolved tenant so it
// only sees its own records. An empty/undefined tenantRef means "unscoped".
export async function getTicketsByKind(
  kind: TicketKind,
  opts?: { tenantRef?: string | null },
): Promise<Sourced<ServiceTicket>> {
  const tenantRef = opts?.tenantRef ?? null;
  const scoped = Boolean(tenantRef);

  // Mock fallback is a NO-DB / can't-run-the-query developer convenience for the
  // UNSCOPED operator view only. A tenant-scoped call must NEVER surface
  // fabricated rows — if it can't reach the real table it returns empty, so a
  // tenant with no tickets (or a DB error) can never be shown another/fake
  // tenant's data. This is the tenant-isolation invariant.
  const fallback = () =>
    mock.serviceTickets.filter(
      (t) => t.kind === kind && (!tenantRef || t.tenantRef === tenantRef),
    );

  // No database configured: unscoped falls back to mock (prototype renders);
  // scoped returns real-empty, never mock.
  if (!hasDb) {
    return scoped
      ? { rows: [], live: false, note: 'no DB (scoped)' }
      : { rows: fallback(), live: false, note: 'no DB' };
  }
  try {
    const params: any[] = [kind];
    let where = 'kind=$1';
    if (tenantRef) {
      params.push(tenantRef);
      where += ` and tenant_ref=$${params.length}`;
    }
    const data = await q<any>(
      `select ${TICKET_COLS} from ops.tickets where ${where} order by opened_at desc nulls last`,
      params
    );
    // The query RAN. Zero rows is a legitimately-empty real result, NOT a
    // "no data source" signal — return [] with live:true. (Previously this fell
    // back to mock on data.length===0, which conflated "DB present, zero rows"
    // with "no DB" and leaked fabricated rows into a tenant-scoped view for a
    // tenant that genuinely has no tickets.)
    return { rows: data.map(mapServiceTicket), live: true };
  } catch (e: any) {
    // Query could not run (connection/SQL error). Unscoped falls back to mock;
    // scoped returns real-empty, never mock.
    return scoped
      ? { rows: [], live: false, note: e?.message ?? 'error' }
      : { rows: fallback(), live: false, note: e?.message ?? 'error' };
  }
}

// Recent tickets created OR updated since an ISO cursor, newest first. Powers
// the Discord bot's outbound-events poll (/api/bot/events). Uses updated_at when
// present, else falls back to created_at, so both new tickets and status changes
// surface. Returns [] with no DB (the bot simply sees no events in dev).
export async function getRecentTickets(
  sinceIso: string,
  limit = 50,
): Promise<Sourced<ServiceTicket>> {
  if (!hasDb) return { rows: [], live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      `select ${TICKET_COLS}
         from ops.tickets
        where coalesce(updated_at, opened_at, created_at) > $1
        order by coalesce(updated_at, opened_at, created_at) asc
        limit $2`,
      [sinceIso, limit],
    );
    return { rows: data.map(mapServiceTicket), live: true };
  } catch (e: any) {
    return { rows: [], live: false, note: e?.message ?? 'error' };
  }
}

// Single ITIL record by ref (used by the detail pane / detail route).
export async function getServiceTicket(ref: string): Promise<{ row: ServiceTicket | null; live: boolean }> {
  const fallback = () => mock.serviceTickets.find((t) => t.ref === ref) ?? null;
  if (!hasDb) return { row: fallback(), live: false };
  try {
    const data = await q1<any>(`select ${TICKET_COLS} from ops.tickets where ref=$1`, [ref]);
    if (!data) return { row: fallback(), live: false };
    return { row: mapServiceTicket(data), live: true };
  } catch {
    return { row: fallback(), live: false };
  }
}

// ---------- Customer 360 (P2 multi-tenancy) ----------
// A single tenant's support picture, assembled from the `ops` mirror tables:
//   * org         → ops.orgs (Clerk org mirror)
//   * members     → ops.org_members
//   * entitlements→ ops.app_entitlements (read-through YT tier/quota) for members
//   * tickets     → ops.tickets scoped by tenant_ref OR customer_email
// The route `id` is the tenant key: a Clerk org id (matches ops.orgs.id /
// tenant_ref) or a customer email. Everything degrades to a plausible mock so the
// page renders without a DB.
export type Customer360Member = { userId: string; role: string | null };
export type Customer360Entitlement = {
  userId: string; app: string; tier: string | null;
  quotaUsed: number | null; quotaLimit: number | null; quotaPeriod: string | null;
  syncedAt: string | null;
};
export type Customer360 = {
  id: string;
  name: string;
  email: string | null;
  org: { id: string; name: string | null } | null;
  members: Customer360Member[];
  entitlements: Customer360Entitlement[];
  tickets: ServiceTicket[];
  live: boolean;
  note?: string;
};

// Derive a human display name from a raw tenant id ("northwind" → "northwind.io";
// an id that already looks like a domain/email is passed through).
function tenantDisplayName(id: string): string {
  const clean = id.trim().toLowerCase();
  if (clean.includes('@')) return clean.split('@')[1] ?? clean;
  return clean.includes('.') ? clean : `${clean}.io`;
}

export async function getCustomer360(id: string): Promise<Customer360> {
  const decoded = decodeURIComponent(id);
  const name = tenantDisplayName(decoded);

  // Offline fallback: name from the id + a slice of mock tickets so the screen
  // is never blank in dev.
  const fallback = (note: string): Customer360 => ({
    id: decoded,
    name,
    email: decoded.includes('@') ? decoded : `ops@${name}`,
    org: null,
    members: [],
    entitlements: [],
    tickets: mock.serviceTickets.slice(0, 3),
    live: false,
    note,
  });

  if (!hasDb) return fallback('no DB');

  try {
    // 1. Tickets for this tenant — match on tenant_ref OR customer_email so both
    //    org-scoped and contact-scoped intake rows resolve.
    const ticketRows = await q<any>(
      `select ${TICKET_COLS} from ops.tickets
         where tenant_ref = $1 or customer_email = $1
         order by opened_at desc nulls last`,
      [decoded],
    );
    const tickets = ticketRows.map(mapServiceTicket);

    // 2. Org mirror — the id may be a Clerk org id; also try the tenant_ref
    //    carried by the tickets (when the route id is an email).
    const orgIds = Array.from(
      new Set([decoded, ...tickets.map((t) => t.tenantRef).filter(Boolean)]),
    ) as string[];
    const orgRow = orgIds.length
      ? await q1<{ id: string; name: string | null }>(
          'select id, name from ops.orgs where id = any($1) limit 1',
          [orgIds],
        )
      : null;
    const org = orgRow ? { id: orgRow.id, name: orgRow.name } : null;

    // 3. Members of the resolved org.
    let members: Customer360Member[] = [];
    let entitlements: Customer360Entitlement[] = [];
    if (org) {
      const memberRows = await q<{ clerk_user_id: string; org_role: string | null }>(
        'select clerk_user_id, org_role from ops.org_members where org_id = $1 order by created_at asc',
        [org.id],
      );
      members = memberRows.map((m) => ({ userId: m.clerk_user_id, role: m.org_role }));

      // 4. Read-through entitlements (YT tier/quota) for the org's members.
      const memberIds = members.map((m) => m.userId);
      if (memberIds.length) {
        const entRows = await q<any>(
          `select clerk_user_id, app, tier, quota_used, quota_limit, quota_period, synced_at
             from ops.app_entitlements where clerk_user_id = any($1)`,
          [memberIds],
        );
        entitlements = entRows.map((r) => ({
          userId: r.clerk_user_id,
          app: r.app,
          tier: r.tier ?? null,
          quotaUsed: r.quota_used == null ? null : Number(r.quota_used),
          quotaLimit: r.quota_limit == null ? null : Number(r.quota_limit),
          quotaPeriod: r.quota_period ?? null,
          syncedAt: r.synced_at
            ? (r.synced_at instanceof Date ? r.synced_at.toISOString() : r.synced_at)
            : null,
        }));
      }
    }

    // Prefer a real customer name/email off the tickets when present.
    const firstNamed = tickets.find((t) => t.customerName)?.customerName ?? null;
    const firstEmail = tickets.find((t) => t.customerEmail)?.customerEmail
      ?? (decoded.includes('@') ? decoded : null);

    return {
      id: decoded,
      name: org?.name ?? firstNamed ?? name,
      email: firstEmail,
      org,
      members,
      entitlements,
      tickets,
      live: true,
    };
  } catch (e: any) {
    return fallback(e?.message ?? 'error');
  }
}

// ---------- Service management writes (server-only) ----------

// Per-kind ref prefixes — must match ops.next_ticket_ref() in
// db/init/03_itil_ticket_refs.sql.
const KIND_PREFIX: Record<TicketKind, string> = {
  incident: 'INC', request: 'REQ', change: 'CHG', problem: 'PRB', release: 'REL',
};

// ITIL impact×urgency → priority matrix. Both axes are high|medium|low; the
// result is one of the Severity bands the UI renders.
const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
export function derivePriority(impact?: string, urgency?: string): Severity {
  const score = (IMPACT_RANK[impact ?? ''] ?? 2) + (IMPACT_RANK[urgency ?? ''] ?? 2);
  if (score >= 6) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export type CreateTicketInput = {
  kind: TicketKind;
  title: string;
  description?: string;
  app?: string;            // YT|Sentinel|Bruce|Estate
  impact?: string;         // high|medium|low
  urgency?: string;        // high|medium|low
  priority?: Severity;     // optional explicit override of the matrix
  status?: string;
  source?: string;
  slaDue?: string | null;
  // P2 multi-tenancy — the tenant (Clerk org id) + customer contact this ticket
  // is for. Persisted to BOTH the first-class columns AND attrs (the shared
  // contract with the intake agent) so reads resolve from either side.
  tenantRef?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  attrs?: Record<string, any>;
};

// Insert a new ITIL record. Mints a per-kind ref (INC-/REQ-/CHG-/PRB-/REL-####)
// via ops.next_ticket_ref() and passes it explicitly so the legacy OPS- trigger
// is bypassed. Returns the new ref.
export async function createTicket(input: CreateTicketInput): Promise<{ ref: string }> {
  if (!hasDb) throw new Error('no DB');
  const kind = input.kind;
  const status = input.status ?? (KIND_STATUSES[kind]?.[0] ?? 'open');
  const priority = input.priority ?? derivePriority(input.impact, input.urgency);

  // Mint the ref SQL-side (race-safe sequence). Fall back to a counted ref if
  // the function is missing (e.g. migration 03 not yet applied).
  let ref: string;
  try {
    const minted = await q1<{ ref: string }>('select ops.next_ticket_ref($1) as ref', [kind]);
    ref = minted?.ref ?? '';
  } catch {
    ref = '';
  }
  if (!ref) {
    const prefix = KIND_PREFIX[kind] ?? 'OPS';
    const row = await q1<{ n: string }>(
      'select count(*)::text as n from ops.tickets where kind=$1',
      [kind]
    );
    const n = (row ? Number(row.n) : 0) + 1;
    ref = `${prefix}-${String(n).padStart(4, '0')}`;
  }

  // Keep the shared contract: mirror the tenant fields into attrs too, so a
  // reader coming from either side (column or attrs) resolves the same value.
  const tenantRef = input.tenantRef ?? null;
  const customerEmail = input.customerEmail ?? null;
  const customerName = input.customerName ?? null;
  const attrs: Record<string, any> = { ...(input.attrs ?? {}) };
  if (tenantRef != null) attrs.tenant_ref = tenantRef;
  if (customerEmail != null) attrs.customer_email = customerEmail;
  if (customerName != null) attrs.customer_name = customerName;

  const inserted = await q1<{ ref: string }>(
    `insert into ops.tickets
       (ref, kind, type, title, description, status, priority, impact, urgency, app, source, sla_due,
        tenant_ref, customer_email, customer_name, attrs)
     values
       ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     returning ref`,
    [
      ref,
      kind,
      input.title,
      input.description ?? null,
      status,
      priority,
      input.impact ?? null,
      input.urgency ?? null,
      input.app ?? 'Estate',
      input.source ?? 'manual',
      input.slaDue ?? null,
      tenantRef,
      customerEmail,
      customerName,
      JSON.stringify(attrs),
    ]
  );
  if (!inserted) throw new Error('insert failed');
  return { ref: inserted.ref };
}

export type UpdateTicketInput = {
  status?: string;
  assignee?: string;       // stored in attrs.assignee (no users table dependency)
  priority?: Severity;
  impact?: string;
  urgency?: string;
  attrs?: Record<string, any>;  // shallow-merged into existing attrs
};

// Patch a ticket's workflow fields. `assignee` and any `attrs` are merged into
// the jsonb attrs column; status/priority/impact/urgency update their columns.
// Returns the updated row mapped to a ServiceTicket.
export async function updateTicket(
  ref: string,
  patch: UpdateTicketInput
): Promise<{ row: ServiceTicket | null }> {
  if (!hasDb) throw new Error('no DB');

  // Merge attrs first (assignee lives in attrs alongside any passed attrs).
  const attrMerge: Record<string, any> = { ...(patch.attrs ?? {}) };
  if (patch.assignee !== undefined) attrMerge.assignee = patch.assignee;

  const sets: string[] = [];
  const vals: any[] = [ref];
  const add = (frag: string, val: any) => { vals.push(val); sets.push(frag.replace('?', `$${vals.length}`)); };

  if (patch.status !== undefined) add('status = ?', patch.status);
  if (patch.priority !== undefined) add('priority = ?', patch.priority);
  if (patch.impact !== undefined) add('impact = ?', patch.impact);
  if (patch.urgency !== undefined) add('urgency = ?', patch.urgency);
  if (Object.keys(attrMerge).length > 0) add('attrs = ops.tickets.attrs || ?::jsonb', JSON.stringify(attrMerge));

  if (sets.length === 0) {
    return getServiceTicket(ref).then((r) => ({ row: r.row }));
  }

  const data = await q1<any>(
    `update ops.tickets set ${sets.join(', ')} where ref=$1 returning ${TICKET_COLS}`,
    vals
  );
  return { row: data ? mapServiceTicket(data) : null };
}

// ---------- P3 — ticket ownership (assignment) ----------
// Set a ticket's owner. Writes the first-class assignee column + assigned_at AND
// mirrors attrs.assignee (the shared contract) so readers on either side resolve
// the same owner. Pass assignee '' or '—' to UNASSIGN (clears the column + stamp).
// Additive — does not change updateTicket's signature or the createTicket path.
export async function assignTicket(
  ref: string,
  assigneeId: string,
): Promise<{ row: ServiceTicket | null }> {
  if (!hasDb) throw new Error('no DB');
  const clean = (assigneeId ?? '').trim();
  const unassign = clean === '' || clean === '—';

  const data = await q1<any>(
    `update ops.tickets
        set assignee    = $2,
            assigned_at = case when $2 is null then null else now() end,
            attrs = coalesce(attrs, '{}'::jsonb)
                    || jsonb_build_object('assignee', coalesce($2, '—')),
            updated_at  = now()
      where ref = $1
      returning ${TICKET_COLS}`,
    [ref, unassign ? null : clean],
  );
  return { row: data ? mapServiceTicket(data) : null };
}

// Every open-ish ticket owned by `assigneeId` (a Clerk user id / label), newest
// first — powers an "assigned to me" queue. Matches the first-class column, with
// an attrs.assignee fallback for rows written before the column existed.
export async function getTicketsAssignedTo(
  assigneeId: string,
): Promise<Sourced<ServiceTicket>> {
  const id = (assigneeId ?? '').trim();
  if (!hasDb || !id) {
    return {
      rows: mock.serviceTickets.filter((t) => t.assignee === id),
      live: false,
      note: hasDb ? 'no assignee' : 'no DB',
    };
  }
  try {
    const data = await q<any>(
      `select ${TICKET_COLS} from ops.tickets
        where assignee = $1 or attrs->>'assignee' = $1
        order by opened_at desc nulls last`,
      [id],
    );
    return { rows: data.map(mapServiceTicket), live: true };
  } catch (e: any) {
    return {
      rows: mock.serviceTickets.filter((t) => t.assignee === id),
      live: false,
      note: e?.message ?? 'error',
    };
  }
}

// ---------- Related-record creation + linking (ops.links) ----------

// Relation labels written into ops.links when one ticket spawns another. The
// source ticket is always the `src` side; the new/target ticket is the `dst`
// side, so the linked-records panel reads them via getTicketEdges either way.
const RELATED_RELATION: Record<'problem' | 'change', string> = {
  problem: 'has_problem',
  change: 'has_change',
};

// Create a new ITIL record (problem|change) FROM an existing source ticket and
// link the two via ops.links (src=source ticket ref, dst=new ticket ref). Copies
// the source's app + impact/urgency and derives a sensible title/description. The
// new record's status defaults to the first workflow state for its kind. Returns
// the new ref. Idempotency isn't attempted — each click mints a fresh record.
export async function createRelatedTicket(
  sourceRef: string,
  kind: 'problem' | 'change'
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  if (!hasDb) throw new Error('no DB');

  const { row: source } = await getServiceTicket(sourceRef);
  if (!source) return { ok: false, error: `ticket ${sourceRef} not found` };

  const title =
    kind === 'problem'
      ? `Problem: ${source.title}`
      : `Change for ${source.ref}`;

  const description =
    kind === 'problem'
      ? `Problem investigation raised from ${source.ref} — ${source.title}.\n\n${source.description ?? ''}`.trim()
      : `Change raised from ${source.ref} — ${source.title}.\n\n${source.description ?? ''}`.trim();

  const { ref: newRef } = await createTicket({
    kind,
    title,
    description,
    app: source.app,
    impact: source.impact && source.impact !== '—' ? source.impact : undefined,
    urgency: source.urgency && source.urgency !== '—' ? source.urgency : undefined,
    source: 'related',
  });

  // Link source → new. Idempotent on the unique key (defensive — a fresh ref
  // won't collide, but ON CONFLICT keeps this safe if a ref is ever reused).
  await q(
    `insert into ops.links (src_type, src_id, dst_type, dst_id, relation, created_by)
     values ('ticket', $1, 'ticket', $2, $3, 'auto:rule')
     on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
    [sourceRef, newRef, RELATED_RELATION[kind]]
  );

  return { ok: true, ref: newRef };
}

// Link a source ticket to an EXISTING target ticket (both by ref). Validates the
// target exists in ops.tickets, then inserts an ops.links row (idempotent on the
// unique key). Default relation 'related'. Stores src=source, dst=target so the
// edge surfaces in both tickets' Linked records panels via getTicketEdges.
export async function linkTicketToTicket(
  sourceRef: string,
  targetRef: string,
  relation = 'related',
  createdBy = 'manual'
): Promise<{ ok: boolean; error?: string }> {
  if (!hasDb) throw new Error('no DB');

  const target = await q1<{ ref: string }>('select ref from ops.tickets where ref=$1', [targetRef]);
  if (!target) return { ok: false, error: `ticket ${targetRef} not found` };

  // Defensive: ensure the source exists too, so we don't create dangling edges.
  const src = await q1<{ ref: string }>('select ref from ops.tickets where ref=$1', [sourceRef]);
  if (!src) return { ok: false, error: `ticket ${sourceRef} not found` };

  await q(
    `insert into ops.links (src_type, src_id, dst_type, dst_id, relation, created_by)
     values ('ticket', $1, 'ticket', $2, $3, $4)
     on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
    [sourceRef, targetRef, relation, createdBy]
  );

  return { ok: true };
}

// ---------- Generic manual link (ops.links) — powers POST /api/links ----------
// Node-type + relation vocab the graph understands. Kept in sync with the
// comments in db/init/08_links_graph.sql.
export const LINK_NODE_TYPES = [
  'finding', 'ticket', 'component', 'kb', 'container', 'user', 'scan', 'alert',
] as const;
export const LINK_RELATIONS = [
  'raises', 'affects', 'runs_on', 'documents', 'runbook_for',
  'has_problem', 'has_change', 'related', 'mitigates',
] as const;
export type LinkNodeType = (typeof LINK_NODE_TYPES)[number];

// Resolve whether a (type,id) node actually exists, so we never create dangling
// edges. KB lives in files (validated by the API route), container/user/scan/
// alert ids aren't strongly enforced here — only the DB-backed entities are
// checked. Returns true when we can't check (so the caller's own validation
// takes over) or when the row exists.
async function nodeExists(type: string, id: string): Promise<boolean> {
  if (!hasDb) return false;
  try {
    switch (type) {
      case 'finding': return Boolean(await q1<{ ref: string }>('select ref from ops.findings where ref=$1', [id]));
      case 'ticket': return Boolean(await q1<{ ref: string }>('select ref from ops.tickets where ref=$1', [id]));
      case 'component': return Boolean(await q1<{ key: string }>('select key from ops.components where key=$1', [id]));
      default: return true; // kb / container / user / scan / alert — not DB-enforced here
    }
  } catch {
    return false;
  }
}

export type CreateLinkInput = {
  srcType: string; srcId: string;
  dstType: string; dstId: string;
  relation?: string;
  createdBy?: string;
};

// Insert a generic edge into ops.links (idempotent on the unique 5-tuple).
// Validates both node types are in the vocab, the relation is in the vocab, and
// (for DB-backed types) that both ends exist. Self-loops are rejected.
export async function createLink(input: CreateLinkInput): Promise<{ ok: boolean; error?: string }> {
  if (!hasDb) throw new Error('no DB');
  const { srcType, srcId, dstType, dstId } = input;
  const relation = input.relation && input.relation.trim() ? input.relation.trim() : 'related';
  const createdBy = input.createdBy && input.createdBy.trim() ? input.createdBy.trim() : 'manual';

  if (!(LINK_NODE_TYPES as readonly string[]).includes(srcType)) return { ok: false, error: `invalid src_type: ${srcType}` };
  if (!(LINK_NODE_TYPES as readonly string[]).includes(dstType)) return { ok: false, error: `invalid dst_type: ${dstType}` };
  if (!(LINK_RELATIONS as readonly string[]).includes(relation)) return { ok: false, error: `invalid relation: ${relation}` };
  if (!srcId || !dstId) return { ok: false, error: 'src_id and dst_id are required' };
  if (srcType === dstType && srcId === dstId) return { ok: false, error: 'cannot link a node to itself' };

  if (!(await nodeExists(srcType, srcId))) return { ok: false, error: `${srcType} ${srcId} not found` };
  if (!(await nodeExists(dstType, dstId))) return { ok: false, error: `${dstType} ${dstId} not found` };

  await q(
    `insert into ops.links (src_type, src_id, dst_type, dst_id, relation, created_by)
       values ($1, $2, $3, $4, $5, $6)
     on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
    [srcType, srcId, dstType, dstId, relation, createdBy]
  );
  return { ok: true };
}

// ---------- Ticket activity / updates (ops.comments) ----------
export type TicketComment = {
  id: string;
  author: string;
  kind: string;
  body: string;
  createdAt: string;
};

function mapComment(r: any): TicketComment {
  const meta = (typeof r.metadata === 'string' ? safeJson(r.metadata) : r.metadata) ?? {};
  return {
    id: String(r.id),
    author: meta.author ?? 'System',
    kind: r.kind ?? 'comment',
    body: r.body ?? '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

// Timeline of updates/comments for one ITIL ticket (oldest → newest). Resolves
// ref → ticket id, then reads ops.comments. Mock fallback returns [].
export async function getTicketComments(ref: string): Promise<TicketComment[]> {
  if (!hasDb) return [];
  try {
    const t = await q1<{ id: string }>('select id from ops.tickets where ref=$1', [ref]);
    if (!t) return [];
    const rows = await q<any>(
      'select id, body, kind, metadata, created_at from ops.comments where ticket_id=$1 order by created_at asc',
      [t.id]
    );
    return rows.map(mapComment);
  } catch {
    return [];
  }
}

// Append an update/comment to a ticket. The author LABEL (Clerk user name/id, or
// 'Claude') is stored in metadata->>'author'; author_user_id stays null because
// ops.comments.author_user_id is a uuid and Clerk ids are text. Returns the new
// row, or null if the ticket ref doesn't resolve / no DB.
export async function addTicketComment(
  ref: string,
  body: string,
  author: string,
  kind = 'update'
): Promise<TicketComment | null> {
  if (!hasDb) throw new Error('no DB');
  const t = await q1<{ id: string }>('select id from ops.tickets where ref=$1', [ref]);
  if (!t) return null;
  const row = await q1<any>(
    `insert into ops.comments (ticket_id, author_user_id, body, kind, metadata)
     values ($1, null, $2, $3, $4::jsonb)
     returning id, body, kind, metadata, created_at`,
    [t.id, body, kind, JSON.stringify({ author })]
  );
  return row ? mapComment(row) : null;
}

// ---------- Email-to-ticket threading (attrs.email_message_ids) ----------
// Inbound support emails are threaded by RFC-5322 Message-ID: each message id we
// have seen for a ticket is stored in attrs.email_message_ids (a jsonb array of
// strings). No new column / DDL — this is purely additive over the existing attrs
// jsonb, so it never touches ops.tickets' schema or createTicket's signature.

// Find the ticket whose attrs.email_message_ids array contains ANY of `ids`
// (the inbound message's In-Reply-To + References header ids). Returns the most
// recently opened match, or null. Used to thread replies onto the same ticket.
export async function findTicketByEmailMessageIds(ids: string[]): Promise<ServiceTicket | null> {
  if (!hasDb) return null;
  const clean = ids.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  if (clean.length === 0) return null;
  try {
    // `?|` = jsonb array/object contains ANY of the given text keys/elements.
    const data = await q1<any>(
      `select ${TICKET_COLS} from ops.tickets
        where attrs->'email_message_ids' ?| $1::text[]
        order by opened_at desc nulls last
        limit 1`,
      [clean]
    );
    return data ? mapServiceTicket(data) : null;
  } catch {
    return null;
  }
}

// Append a Message-ID to a ticket's attrs.email_message_ids array (dedup-safe),
// so a later reply that references it threads back onto this ticket. No-op if the
// id is already present. Best-effort; never throws to the caller path.
export async function appendEmailMessageId(ref: string, messageId: string): Promise<void> {
  if (!hasDb) return;
  const id = (messageId ?? '').trim();
  if (!id) return;
  try {
    await q(
      `update ops.tickets
          set attrs = jsonb_set(
                coalesce(attrs, '{}'::jsonb),
                '{email_message_ids}',
                case
                  when coalesce(attrs->'email_message_ids', '[]'::jsonb) @> to_jsonb($2::text)
                    then coalesce(attrs->'email_message_ids', '[]'::jsonb)
                  else coalesce(attrs->'email_message_ids', '[]'::jsonb) || to_jsonb($2::text)
                end
              ),
              updated_at = now()
        where ref = $1`,
      [ref, id]
    );
  } catch {
    /* threading metadata is best-effort */
  }
}

// ---------- Roadmap (ops.roadmap_items) ----------
function mapRoadmap(r: any): RoadmapItem {
  return {
    itemKey: r.item_key,
    title: r.title,
    description: r.description ?? '',
    status: r.status ?? 'backlog',
    app: r.app ?? 'Estate',
    sortOrder: Number(r.sort_order) || 0,
  };
}

export async function getRoadmap(): Promise<Sourced<RoadmapItem>> {
  if (!hasDb) return { rows: mock.roadmapItems, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select item_key,title,description,status,app,sort_order from ops.roadmap_items order by sort_order asc, created_at asc'
    );
    if (data.length === 0) return { rows: mock.roadmapItems, live: false, note: 'empty' };
    return { rows: data.map(mapRoadmap), live: true };
  } catch (e: any) {
    return { rows: mock.roadmapItems, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Changelog (ops.changelog_entries) ----------
export async function getChangelog(): Promise<Sourced<ChangelogEntry>> {
  if (!hasDb) return { rows: mock.changelogEntries, live: false, note: 'no DB' };
  try {
    const data = await q<any>(
      'select version,label,date,body,app from ops.changelog_entries order by date desc'
    );
    if (data.length === 0) return { rows: mock.changelogEntries, live: false, note: 'empty' };
    const rows: ChangelogEntry[] = data.map((r) => ({
      version: r.version ?? '',
      label: r.label ?? '',
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      body: r.body ?? '',
      app: r.app ?? 'Estate',
    }));
    return { rows, live: true };
  } catch (e: any) {
    return { rows: mock.changelogEntries, live: false, note: e?.message ?? 'error' };
  }
}

// ---------- Programmatic write helpers (token-gated ingest routes) ----------

const ROADMAP_STATUSES = ['backlog', 'in_progress', 'in_review', 'shipped'] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapUpsertInput = {
  item_key: string;
  title?: string;
  description?: string;
  status?: string;
  app?: string;
  sort_order?: number;
};

// Upsert roadmap items by item_key. Parameterized; ON CONFLICT (item_key) updates
// the mutable columns + updated_at. Returns the number of rows upserted.
export async function upsertRoadmapItems(items: RoadmapUpsertInput[]): Promise<number> {
  if (!hasDb) throw new Error('no DB');
  let upserted = 0;
  for (const it of items) {
    const status = ROADMAP_STATUSES.includes(it.status as RoadmapStatus)
      ? (it.status as RoadmapStatus)
      : 'backlog';
    const app = typeof it.app === 'string' && it.app.trim() ? it.app.trim() : 'Estate';
    const sortOrder = Number.isFinite(it.sort_order) ? Math.trunc(it.sort_order as number) : 0;
    await q(
      `insert into ops.roadmap_items (item_key, title, description, status, app, sort_order)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (item_key) do update set
         title = excluded.title,
         description = excluded.description,
         status = excluded.status,
         app = excluded.app,
         sort_order = excluded.sort_order,
         updated_at = now()`,
      [
        it.item_key,
        typeof it.title === 'string' ? it.title : null,
        typeof it.description === 'string' ? it.description : null,
        status,
        app,
        sortOrder,
      ]
    );
    upserted += 1;
  }
  return upserted;
}

// ---------- Roadmap in-app CRUD (Clerk-gated /api/roadmap, server-only) ----------
// Distinct from upsertRoadmapItems (token-gated ingest): these power the operator
// modal, validate inputs and return the mapped row so the UI can reflect the save.

export const ROADMAP_APPS = ['YT', 'Sentinel', 'Bruce', 'Estate'] as const;
export type RoadmapApp = (typeof ROADMAP_APPS)[number];

function normStatus(status: unknown): RoadmapStatus {
  return ROADMAP_STATUSES.includes(status as RoadmapStatus) ? (status as RoadmapStatus) : 'backlog';
}
function normApp(app: unknown): RoadmapApp {
  return ROADMAP_APPS.includes(app as RoadmapApp) ? (app as RoadmapApp) : 'Estate';
}

export type RoadmapCreateInput = {
  item_key?: string;       // optional — minted if absent
  title: string;
  description?: string;
  status?: string;
  app?: string;
  sort_order?: number;
};

export type RoadmapUpdateInput = {
  title?: string;
  description?: string;
  status?: string;
  app?: string;
  sort_order?: number;
};

const ROADMAP_COLS = 'item_key,title,description,status,app,sort_order';

// Mint the next RM-#### key by scanning existing keys (race-tolerant enough for a
// single-operator admin tool; the unique constraint on item_key is the backstop).
async function nextRoadmapKey(): Promise<string> {
  const rows = await q<{ item_key: string }>(
    "select item_key from ops.roadmap_items where item_key ~ '^RM-[0-9]+$'"
  );
  let max = 0;
  for (const r of rows) {
    const n = Number(r.item_key.slice(3));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `RM-${String(max + 1).padStart(3, '0')}`;
}

// Create a roadmap item. Title required; status/app validated against the enums;
// item_key minted (RM-###) when not supplied. Returns the new row.
export async function createRoadmapItem(input: RoadmapCreateInput): Promise<{ row: RoadmapItem | null }> {
  if (!hasDb) throw new Error('no DB');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('title is required');

  const key = typeof input.item_key === 'string' && input.item_key.trim()
    ? input.item_key.trim()
    : await nextRoadmapKey();

  const data = await q1<any>(
    `insert into ops.roadmap_items (item_key, title, description, status, app, sort_order)
     values ($1, $2, $3, $4, $5, $6)
     returning ${ROADMAP_COLS}`,
    [
      key,
      title,
      typeof input.description === 'string' ? input.description : null,
      normStatus(input.status),
      normApp(input.app),
      Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order as number) : 0,
    ]
  );
  return { row: data ? mapRoadmap(data) : null };
}

// Patch a roadmap item by item_key. Only supplied fields are updated; status/app
// are validated. Returns the updated row, or null if the key doesn't exist.
export async function updateRoadmapItem(
  itemKey: string,
  patch: RoadmapUpdateInput
): Promise<{ row: RoadmapItem | null }> {
  if (!hasDb) throw new Error('no DB');

  const sets: string[] = [];
  const vals: any[] = [itemKey];
  const add = (frag: string, val: any) => { vals.push(val); sets.push(frag.replace('?', `$${vals.length}`)); };

  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new Error('title cannot be empty');
    add('title = ?', t);
  }
  if (patch.description !== undefined) add('description = ?', String(patch.description));
  if (patch.status !== undefined) add('status = ?', normStatus(patch.status));
  if (patch.app !== undefined) add('app = ?', normApp(patch.app));
  if (patch.sort_order !== undefined) {
    add('sort_order = ?', Number.isFinite(patch.sort_order) ? Math.trunc(patch.sort_order as number) : 0);
  }

  if (sets.length === 0) {
    const data = await q1<any>(`select ${ROADMAP_COLS} from ops.roadmap_items where item_key=$1`, [itemKey]);
    return { row: data ? mapRoadmap(data) : null };
  }

  const data = await q1<any>(
    `update ops.roadmap_items set ${sets.join(', ')} where item_key=$1 returning ${ROADMAP_COLS}`,
    vals
  );
  return { row: data ? mapRoadmap(data) : null };
}

// Delete a roadmap item by item_key. Returns true if a row was removed.
export async function deleteRoadmapItem(itemKey: string): Promise<boolean> {
  if (!hasDb) throw new Error('no DB');
  const data = await q1<{ item_key: string }>(
    'delete from ops.roadmap_items where item_key=$1 returning item_key',
    [itemKey]
  );
  return Boolean(data);
}

export type ChangelogInput = {
  label: string;
  version?: string;
  date?: string;
  body?: string;
  app?: string;
};

// Insert changelog entries. There's no unique constraint, so to stay re-runnable
// we skip any entry whose (version, label) pair already exists (NULL-safe match).
// Returns { inserted, skipped }.
export async function addChangelogEntries(
  entries: ChangelogInput[]
): Promise<{ inserted: number; skipped: number }> {
  if (!hasDb) throw new Error('no DB');
  let inserted = 0;
  let skipped = 0;
  for (const e of entries) {
    const label = e.label.trim();
    const version = typeof e.version === 'string' && e.version.trim() ? e.version.trim() : null;
    const app = typeof e.app === 'string' && e.app.trim() ? e.app.trim() : 'Estate';
    const body = typeof e.body === 'string' ? e.body : null;
    const date = typeof e.date === 'string' && e.date.trim() ? e.date.trim() : null;

    const existing = await q1<{ id: string }>(
      `select id from ops.changelog_entries
       where label = $1 and version is not distinct from $2
       limit 1`,
      [label, version]
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    await q(
      `insert into ops.changelog_entries (version, label, date, body, app)
       values ($1, $2, coalesce($3::timestamptz, now()), $4, $5)`,
      [version, label, date, body, app]
    );
    inserted += 1;
  }
  return { inserted, skipped };
}

// ---------- Global graph (ops.links + node metadata) — powers /api/graph ----------
export type GraphNode = {
  id: string;            // "type:ref" — globally unique in the graph
  type: string;          // finding|ticket|component|kb|container|user|scan|alert
  ref: string;           // the public ref/key/slug (the bare id)
  label: string;         // display label
  severity?: Severity;   // findings/tickets carry severity for colouring
  status?: string;       // live state (container) / status (finding/ticket)
  href: string;          // detail-page deep link
};
export type GraphEdge = { source: string; target: string; relation: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; live: boolean };

function gid(type: string, ref: string): string { return `${type}:${ref}`; }

// Build the whole graph from ops.links, enriching nodes with metadata from
// ops.findings / ops.tickets / ops.components and overlaying LIVE container state
// onto container nodes (no snapshot table — read from the socket-proxy). Every
// node referenced by an edge is materialised even if its metadata lookup misses,
// so the graph never has dangling edges. DB-only; empty graph on no-DB / error.
export async function getGraph(): Promise<Graph> {
  if (!hasDb) return { nodes: [], edges: [], live: false };
  try {
    const links = await q<any>(
      'select src_type, src_id, dst_type, dst_id, relation from ops.links'
    );

    // Collect the distinct nodes the edges reference, per type.
    const nodeIds = new Map<string, { type: string; ref: string }>();
    const want = (type: string, ref: string) => {
      if (ref) nodeIds.set(gid(type, ref), { type, ref });
    };
    const edges: GraphEdge[] = links.map((l: any) => {
      want(l.src_type, l.src_id);
      want(l.dst_type, l.dst_id);
      return { source: gid(l.src_type, l.src_id), target: gid(l.dst_type, l.dst_id), relation: l.relation };
    });

    // Pull metadata for the DB-backed types in bulk.
    const [findingRows, ticketRows, compRows] = await Promise.all([
      q<any>('select ref, title, severity, status from ops.findings'),
      q<any>('select ref, title, priority, status from ops.tickets'),
      q<any>('select key, name, kind from ops.components'),
    ]);
    const findingMeta = new Map(findingRows.map((r) => [r.ref, r]));
    const ticketMeta = new Map(ticketRows.map((r) => [r.ref, r]));
    const compMeta = new Map(compRows.map((r) => [r.key, r]));

    // Live container state overlay (no snapshot table) — best-effort.
    let containerState = new Map<string, string>();
    try {
      const { rows, live } = await getContainers();
      if (live) containerState = new Map(rows.map((c) => [c.name, c.state]));
    } catch { /* leave empty */ }

    const nodes: GraphNode[] = Array.from(nodeIds.values()).map(({ type, ref }) => {
      const base: GraphNode = { id: gid(type, ref), type, ref, label: ref, href: hrefFor(type, ref) };
      if (type === 'finding') {
        const m = findingMeta.get(ref);
        if (m) { base.label = m.title ?? ref; base.severity = (m.severity ?? 'medium') as Severity; base.status = m.status; }
      } else if (type === 'ticket') {
        const m = ticketMeta.get(ref);
        if (m) { base.label = m.title ?? ref; base.severity = (m.priority ?? 'medium') as Severity; base.status = m.status; }
      } else if (type === 'component') {
        const m = compMeta.get(ref);
        if (m) { base.label = m.name ?? ref; }
      } else if (type === 'container') {
        base.status = containerState.get(ref) ?? 'unknown';
      }
      return base;
    });

    return { nodes, edges, live: true };
  } catch {
    return { nodes: [], edges: [], live: false };
  }
}

// ---------- Connectivity probe (for a status badge) ----------
export async function dbStatus(): Promise<{ connected: boolean; users?: number; note?: string }> {
  const sb = await getSupabase();
  if (!sb) return { connected: false, note: 'no connector' };
  const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true });
  if (error) return { connected: false, note: error.message };
  return { connected: true, users: count ?? 0 };
}
