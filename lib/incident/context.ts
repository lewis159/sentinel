// Hermes · Incident Commander — CONTEXT ASSEMBLER.
//
// Given an active incident (an open incident TICKET) or a candidate synthesised
// from the top firing alert, gather the operational picture an on-call commander
// needs in one place:
//
//   { alerts[], recentDeploys, relatedTickets[], monitoringState, timeline[] }
//
// It reuses the estate's REAL read-only monitoring clients (no new wiring):
//   • lib/alertmanager  · getActiveAlerts   — firing alerts (primary signal)
//   • lib/uptime        · getUptimeStatus   — heartbeats (down monitors)
//   • lib/hermes/brain/tools/deploy         — recent CI runs + open PRs
//   • lib/data          · getTicketsByKind  — related incident/problem/change tickets
//
// Everything is DETERMINISTIC (no LLM here) and MOCK-SAFE: every underlying
// client already catches its own errors and returns an `ok:false` state instead
// of throwing, and getTicketsByKind falls back to mock rows with no DB. So this
// assembler cannot throw and renders a useful picture in dev with nothing wired.
//
// Correlation (alerts ↔ tickets) is by SERVICE / keyword: we derive a small set
// of known service tokens present in each alert's name+summary and each ticket's
// title+description+app, and correlate when they share a token.
import 'server-only';

import { getActiveAlerts, type AlertSeverity } from '@/lib/alertmanager';
import { getUptimeStatus } from '@/lib/uptime';
import { getDeployStatusTool } from '@/lib/hermes/brain/tools/deploy';
import { getTicketsByKind } from '@/lib/data';
import type { ServiceTicket } from '@/lib/mock';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverallState = 'operational' | 'degraded' | 'down';

// An active incident the commander is tracking. Either a real open incident
// TICKET (source:'ticket', ref set) or a CANDIDATE synthesised from a firing
// alert that has no matching open incident yet (source:'alert', ref null → the
// operator can "open incident" from it).
export type ActiveIncident = {
  ref: string | null;
  title: string;
  status: string;
  priority: string;
  app: string;
  service: string | null;
  source: 'ticket' | 'alert';
  severity?: AlertSeverity; // when source:'alert'
};

export type IncidentAlert = {
  name: string;
  severity: AlertSeverity;
  summary: string;
  startsAt: string;
  service: string | null;
  correlated: boolean; // shares a service token with the incident
};

export type RelatedTicket = {
  ref: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  app: string;
  matchedOn: string[]; // service tokens that correlated it
};

export type DeploySignal = {
  configured: boolean;
  summary: string;
  repos: Array<{
    repo: string;
    latestRun?: { name: string; branch: string; status: string; conclusion: string | null; url: string };
    openPRs: Array<{ number: number; title: string; ageDays: number; url: string }>;
    error?: string;
  }>;
};

export type MonitoringState = {
  overall: OverallState;
  source: 'alertmanager' | 'uptime-kuma' | 'default';
  alertsFiring: number;
  monitorsDown: string[];
  note?: string;
};

export type TimelineEvent = {
  at: string; // ISO timestamp, or '' when unknown
  kind: 'alert' | 'ticket' | 'deploy' | 'note';
  label: string;
};

export type IncidentContext = {
  incidentRef: string | null;
  title: string;
  primaryService: string | null;
  severity: AlertSeverity | null;
  alerts: IncidentAlert[];
  relatedTickets: RelatedTicket[];
  recentDeploys: DeploySignal;
  monitoringState: MonitoringState;
  timeline: TimelineEvent[];
  assembledAt: string;
};

// ---------------------------------------------------------------------------
// Correlation — deterministic service/keyword extraction
// ---------------------------------------------------------------------------

// Known service tokens we look for as substrings. Order is display order for
// picking a single "primary" service. Kept intentionally small + explicit so the
// correlation is predictable and testable.
export const SERVICE_TOKENS = [
  'postgres', 'database', 'redis', 'queue', 'worker', 'transcription', 'transcribe',
  'minio', 'ollama', 'nginx', 'proxy', 'socket', 'memory', 'cpu', 'disk', 'latency',
  'api', 'auth', 'billing', 'hermes', 'kuma', 'grafana', 'loki',
  // estate apps
  'sentinel', 'bruce', 'estate', 'yt',
] as const;

export type ServiceToken = (typeof SERVICE_TOKENS)[number];

// Extract the set of known service tokens present in an arbitrary text blob.
export function extractServiceTokens(...parts: Array<string | null | undefined>): ServiceToken[] {
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  const out: ServiceToken[] = [];
  for (const tok of SERVICE_TOKENS) {
    // word-ish boundary match so 'api' doesn't hit 'capital' etc.
    const re = new RegExp(`(^|[^a-z])${tok}([^a-z]|$)`, 'i');
    if (re.test(hay)) out.push(tok);
  }
  return out;
}

// The single most-specific service token for a blob (first in SERVICE_TOKENS
// order), or null when none match.
export function primaryService(...parts: Array<string | null | undefined>): ServiceToken | null {
  const toks = extractServiceTokens(...parts);
  return toks.length ? toks[0] : null;
}

// Tokens shared between two token sets — the correlation reason.
function sharedTokens(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t));
}

// ---------------------------------------------------------------------------
// Active incidents (open tickets + alert-only candidates)
// ---------------------------------------------------------------------------

const OPEN_TICKET_STATES = new Set(['resolved', 'closed', 'fulfilled']);

function ticketTokens(t: ServiceTicket): string[] {
  return extractServiceTokens(t.title, t.description, t.app);
}

// Resolve the set of active incidents the commander should show:
//   1. every open incident TICKET (status not resolved/closed), and
//   2. for each firing critical/warning alert that does NOT correlate to any
//      open incident ticket, a CANDIDATE (ref:null) so the operator can open one.
export async function getActiveIncidents(): Promise<ActiveIncident[]> {
  const [tickets, alerts] = await Promise.all([getTicketsByKind('incident'), getActiveAlerts()]);

  const openIncidents = tickets.rows.filter((t) => !OPEN_TICKET_STATES.has(t.status));

  const fromTickets: ActiveIncident[] = openIncidents.map((t) => ({
    ref: t.ref,
    title: t.title,
    status: t.status,
    priority: t.priority,
    app: t.app,
    service: primaryService(t.title, t.description, t.app),
    source: 'ticket',
  }));

  // Candidates from firing alerts with no matching open incident.
  const candidates: ActiveIncident[] = [];
  if (alerts.ok) {
    for (const a of alerts.alerts) {
      if (a.severity !== 'critical' && a.severity !== 'warning') continue;
      const aTokens = extractServiceTokens(a.name, a.summary);
      const matched = openIncidents.some((t) => sharedTokens(aTokens, ticketTokens(t)).length > 0);
      if (matched) continue;
      candidates.push({
        ref: null,
        title: a.summary || a.name,
        status: 'firing',
        priority: a.severity === 'critical' ? 'critical' : 'high',
        app: 'Estate',
        service: primaryService(a.name, a.summary),
        source: 'alert',
        severity: a.severity,
      });
    }
  }

  return [...fromTickets, ...candidates];
}

// ---------------------------------------------------------------------------
// Monitoring state (mirror of support-status mapping, plus down-monitor list)
// ---------------------------------------------------------------------------

function deriveMonitoringState(
  alerts: Awaited<ReturnType<typeof getActiveAlerts>>,
  uptime: Awaited<ReturnType<typeof getUptimeStatus>>,
): MonitoringState {
  if (alerts.ok) {
    const overall: OverallState =
      alerts.groups.critical > 0 ? 'down' : alerts.groups.warning > 0 ? 'degraded' : 'operational';
    const monitorsDown = uptime.ok ? uptime.monitors.filter((m) => !m.up).map((m) => m.name) : [];
    return {
      overall,
      source: 'alertmanager',
      alertsFiring: alerts.alerts.length,
      monitorsDown,
    };
  }
  if (uptime.ok) {
    const down = uptime.monitors.filter((m) => !m.up);
    const overall: OverallState =
      down.length === 0
        ? 'operational'
        : uptime.monitors.length > 0 && down.length >= uptime.monitors.length
          ? 'down'
          : 'degraded';
    return {
      overall,
      source: 'uptime-kuma',
      alertsFiring: 0,
      monitorsDown: down.map((m) => m.name),
    };
  }
  return {
    overall: 'operational',
    source: 'default',
    alertsFiring: 0,
    monitorsDown: [],
    note: alerts.note ?? uptime.note,
  };
}

// ---------------------------------------------------------------------------
// Deploy signal
// ---------------------------------------------------------------------------

async function deriveDeploySignal(): Promise<DeploySignal> {
  const res = await getDeployStatusTool.run({}, { threadId: 'incident-commander', persona: 'incident', actor: 'incident-commander' });
  if (!res.ok) {
    return { configured: false, summary: res.summary, repos: [] };
  }
  const repos = Array.isArray(res.data) ? (res.data as DeploySignal['repos']) : [];
  return { configured: true, summary: res.summary, repos };
}

// ---------------------------------------------------------------------------
// Timeline — deterministic ordering: timestamped events ascending first, then
// the untimed events in a stable insertion order.
// ---------------------------------------------------------------------------

function buildTimeline(
  incident: ActiveIncident,
  alerts: IncidentAlert[],
  deploys: DeploySignal,
  related: RelatedTicket[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const a of alerts) {
    if (!a.correlated) continue;
    events.push({ at: a.startsAt || '', kind: 'alert', label: `Alert firing · ${a.name}` });
  }

  for (const r of deploys.repos) {
    if (!r.latestRun) continue;
    const state = r.latestRun.status === 'completed' ? r.latestRun.conclusion ?? 'completed' : r.latestRun.status;
    events.push({ at: '', kind: 'deploy', label: `${r.repo}: ${r.latestRun.name} on ${r.latestRun.branch} → ${state}` });
  }

  if (incident.ref) {
    events.push({ at: '', kind: 'note', label: `Incident ${incident.ref} tracked (${incident.status})` });
  } else {
    events.push({ at: '', kind: 'note', label: `Candidate incident from firing alert — not yet opened` });
  }

  for (const r of related) {
    events.push({ at: '', kind: 'ticket', label: `Related ${r.ref} (${r.status}) · ${r.title}` });
  }

  // Stable sort: timestamped ascending, untimed keep insertion order last.
  return events
    .map((e, i) => ({ e, i, t: e.at ? Date.parse(e.at) : Number.NaN }))
    .sort((x, y) => {
      const xt = Number.isNaN(x.t);
      const yt = Number.isNaN(y.t);
      if (xt && yt) return x.i - y.i; // both untimed → insertion order
      if (xt) return 1; // untimed after timed
      if (yt) return -1;
      return x.t - y.t || x.i - y.i;
    })
    .map((w) => w.e);
}

// ---------------------------------------------------------------------------
// The assembler
// ---------------------------------------------------------------------------

export async function assembleIncidentContext(incident: ActiveIncident): Promise<IncidentContext> {
  const [alertStatus, uptime, deploys, incidents, problems, changes] = await Promise.all([
    getActiveAlerts(),
    getUptimeStatus(),
    deriveDeploySignal(),
    getTicketsByKind('incident'),
    getTicketsByKind('problem'),
    getTicketsByKind('change'),
  ]);

  // The incident's own service tokens (for correlation).
  const seedTokens = new Set<string>(
    extractServiceTokens(incident.title, incident.service ?? undefined, incident.app),
  );
  // If it's an alert candidate, also pull tokens from the firing alert set.
  const incidentToken = incident.service;

  // ---- Alerts: correlate each firing alert to this incident ----
  const alerts: IncidentAlert[] = alertStatus.ok
    ? alertStatus.alerts.map((a) => {
        const aTokens = extractServiceTokens(a.name, a.summary);
        const correlated =
          sharedTokens(aTokens, [...seedTokens]).length > 0 ||
          (incident.source === 'alert' && a.name === incident.title) ||
          (a.summary && a.summary === incident.title) ||
          false;
        return {
          name: a.name,
          severity: a.severity,
          summary: a.summary,
          startsAt: a.startsAt,
          service: primaryService(a.name, a.summary),
          correlated: Boolean(correlated),
        };
      })
    : [];

  // ---- Related tickets: incidents (excluding self) + problems + changes that
  //      share a service token with this incident ----
  const relatedTickets: RelatedTicket[] = [];
  const consider: Array<{ rows: ServiceTicket[] }> = [incidents, problems, changes];
  for (const group of consider) {
    for (const t of group.rows) {
      if (incident.ref && t.ref === incident.ref) continue; // skip self
      const matchedOn = sharedTokens([...seedTokens], ticketTokens(t));
      if (matchedOn.length === 0) continue;
      relatedTickets.push({
        ref: t.ref,
        kind: t.kind,
        title: t.title,
        status: t.status,
        priority: t.priority,
        app: t.app,
        matchedOn,
      });
    }
  }

  const monitoringState = deriveMonitoringState(alertStatus, uptime);
  const timeline = buildTimeline(incident, alerts, deploys, relatedTickets);

  // Severity: an explicit alert severity, else derive from the highest correlated
  // firing alert.
  const correlatedSev = alerts
    .filter((a) => a.correlated)
    .map((a) => a.severity)
    .sort((x, y) => sevRank(x) - sevRank(y))[0];
  const severity: AlertSeverity | null = incident.severity ?? correlatedSev ?? null;

  return {
    incidentRef: incident.ref,
    title: incident.title,
    primaryService: incidentToken ?? primaryService(incident.title) ?? null,
    severity,
    alerts,
    relatedTickets,
    recentDeploys: deploys,
    monitoringState,
    timeline,
    assembledAt: new Date().toISOString(),
  };
}

function sevRank(s: AlertSeverity): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : s === 'info' ? 2 : 3;
}
