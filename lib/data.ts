// Data access for Sentinel. Reads Sentinel's OWN local Postgres (the `ops`
// schema) for its own entities via the `q`/`q1` helpers, and pulls real YT
// Transcriber data (users/videos) through the configurable Supabase connector.
// Every function falls back to mock data when the DB is unreachable or empty,
// so the prototype always renders. Each returns { rows, live } — `live` true
// means the data came from the real database.

import { hasDb, q, q1 } from './db';
import { getSupabase } from './connectors';
import * as mock from './mock';
import type { Finding, Ticket, AbuseUser, Severity } from './mock';

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

// ---------- Finding graph edges (ops.links, both directions) ----------
export type Edge = { rel: string; type: string; id: string; label: string; href: string };

function hrefFor(type: string, id: string): string {
  switch (type) {
    case 'ticket': return `/tickets/${id}`;
    case 'component': return `/components/${id}`;
    case 'kb': return `/kb/${id}`;
    case 'finding': return `/findings/${id}`;
    case 'scan': return `/scans/runs/${id}`;
    default: return '#';
  }
}

export async function getFindingEdges(ref: string): Promise<Edge[]> {
  const fallback = (): Edge[] => mock.findingLinks[ref] ?? [];
  if (!hasDb) return fallback();
  try {
    // Read links where this finding is on the source side OR the target side.
    const rows = await q<any>(
      "select relation,src_type,src_id,dst_type,dst_id from ops.links where (src_type='finding' and src_id=$1) or (dst_type='finding' and dst_id=$1)",
      [ref]
    );
    if (rows.length === 0) return fallback();
    return rows.map((l: any) => {
      // Pick the side that is NOT this finding as the edge's "other" node.
      const isSrc = l.src_type === 'finding' && l.src_id === ref;
      const type = isSrc ? l.dst_type : l.src_type;
      const id = isSrc ? l.dst_id : l.src_id;
      return { rel: l.relation ?? 'linked', type, id, label: id, href: hrefFor(type, id) };
    });
  } catch {
    return fallback();
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
    "insert into ops.links (src_type,src_id,dst_type,dst_id,relation) values ('finding',$1,'ticket',$2,'raises')",
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

// ---------- Connectivity probe (for a status badge) ----------
export async function dbStatus(): Promise<{ connected: boolean; users?: number; note?: string }> {
  const sb = await getSupabase();
  if (!sb) return { connected: false, note: 'no connector' };
  const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true });
  if (error) return { connected: false, note: error.message };
  return { connected: true, users: count ?? 0 };
}
