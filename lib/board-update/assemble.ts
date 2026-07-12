// Board / Founder-Update assembler.
//
// Deterministically gathers a monthly board/investor/founder update from the
// READ-ONLY estate spine:
//   - metrics  (MRR / new revenue / churn / runway) from the Stripe read path
//              WHERE WIRED, else a clearly-marked placeholder + TODO (the current
//              Stripe tool path is single-charge read only, so MRR/churn/runway
//              are NOT derivable from it — see lib/board-update/revenue.ts).
//   - roadmap  (shipped / in-flight) from ops.roadmap_items by status.
//   - support  (ticket volume / resolved / SLA breaches) from ops.tickets + spine.
//   - ops      (incidents / uptime) from the ITIL spine + Uptime Kuma.
//   - wins     derived from shipped roadmap + changelog + resolved incidents.
//
// EVERY section degrades gracefully: a section with NO data source is marked
// `hasData:false` ("no data") — it is NEVER fabricated. All source reads are
// read-only; nothing here mutates or sends.
//
// PURE assembly: all data access is injected through `deps` (defaulting to the
// real read helpers) so this module is unit-testable with mocked DB/Stripe.

import type { RoadmapItem, ChangelogEntry, ServiceTicket, Ticket } from '@/lib/mock';
import { getRoadmap, getTickets, getTicketsByKind, getChangelog } from '@/lib/data';
import { getUptimeStatus } from '@/lib/uptime';
import { readRevenue } from './revenue';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type Period = { label: string; start: Date; end: Date };

// A single headline metric. `available:false` renders as "no data" and MUST
// carry a `todo` naming the real source that would populate it.
export type MetricValue = {
  available: boolean;
  display: string; // e.g. "£4,200 / mo" or "No data"
  value?: number | null;
  currency?: string;
  source: string;
  todo?: string;
};

export type RevenueMetrics = {
  mrr: MetricValue;
  newRevenue: MetricValue;
  churn: MetricValue;
  runway: MetricValue;
};

export type RevenueReader = (period: Period) => Promise<RevenueMetrics>;

export type RoadmapLine = { key: string; title: string; app: string; status: string };

// Per-section provenance so the UI + template can honestly say where a section
// came from and whether it is live or a mock/degraded read.
export type SectionMeta = { hasData: boolean; source: string; live: boolean; note?: string };

export type BoardUpdate = {
  period: string;
  periodStart: string;
  generatedAt: string;
  metrics: RevenueMetrics;
  roadmap: { shipped: RoadmapLine[]; inFlight: RoadmapLine[] } & SectionMeta;
  support: { ticketVolume: number; resolved: number; open: number; slaBreaches: number } & SectionMeta;
  ops: { incidents: number; incidentsResolved: number; uptime: MetricValue } & SectionMeta;
  wins: { items: string[] } & SectionMeta;
};

// ---------------------------------------------------------------------------
// Dependency injection (defaults → the real read-only helpers)
// ---------------------------------------------------------------------------

type Sourced<T> = { rows: T[]; live: boolean; note?: string };

export type AssembleDeps = {
  getRoadmap: () => Promise<Sourced<RoadmapItem>>;
  getTickets: () => Promise<Sourced<Ticket>>;
  getIncidents: () => Promise<Sourced<ServiceTicket>>;
  getChangelog: () => Promise<Sourced<ChangelogEntry>>;
  getUptime: () => Promise<{ monitors: { name: string; up: boolean }[]; ok: boolean; note?: string }>;
  readRevenue: RevenueReader;
};

const defaultDeps: AssembleDeps = {
  getRoadmap,
  getTickets,
  getIncidents: () => getTicketsByKind('incident'),
  getChangelog,
  getUptime: getUptimeStatus,
  readRevenue,
};

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The calendar month `now` falls in (UTC), e.g. "July 2026".
export function monthPeriod(now: Date = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  return { label: `${MONTHS[m]} ${y}`, start, end };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

const SHIPPED = new Set(['shipped']);
const IN_FLIGHT = new Set(['in_progress', 'in_review']);

function buildRoadmap(src: Sourced<RoadmapItem>): BoardUpdate['roadmap'] {
  const line = (r: RoadmapItem): RoadmapLine => ({
    key: r.itemKey,
    title: r.title,
    app: String(r.app ?? 'Estate'),
    status: r.status,
  });
  const shipped = src.rows.filter((r) => SHIPPED.has(r.status)).map(line);
  const inFlight = src.rows.filter((r) => IN_FLIGHT.has(r.status)).map(line);
  const hasData = shipped.length > 0 || inFlight.length > 0;
  return {
    shipped,
    inFlight,
    hasData,
    live: src.live,
    source: 'ops.roadmap_items',
    note: hasData ? src.note : 'no shipped or in-flight items',
  };
}

const RESOLVED_STATUSES = new Set(['resolved', 'closed', 'done', 'implemented']);

function pastSla(t: ServiceTicket, now: Date): boolean {
  if (!t.slaDue) return false;
  if (RESOLVED_STATUSES.has(t.status)) return false;
  const due = new Date(t.slaDue).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

function buildSupport(
  tickets: Sourced<Ticket>,
  incidents: Sourced<ServiceTicket>,
  now: Date,
): BoardUpdate['support'] {
  const rows = tickets.rows;
  const resolved = rows.filter((t) => RESOLVED_STATUSES.has(t.status)).length;
  const open = rows.length - resolved;
  const slaBreaches = incidents.rows.filter((t) => pastSla(t, now)).length;
  const hasData = rows.length > 0;
  return {
    ticketVolume: rows.length,
    resolved,
    open,
    slaBreaches,
    hasData,
    live: tickets.live,
    source: 'ops.tickets (+ ITIL spine for SLA)',
    note: hasData ? tickets.note : 'no tickets',
  };
}

function buildOps(
  incidents: Sourced<ServiceTicket>,
  uptime: { monitors: { name: string; up: boolean }[]; ok: boolean; note?: string },
): BoardUpdate['ops'] {
  const total = incidents.rows.length;
  const incidentsResolved = incidents.rows.filter((t) => RESOLVED_STATUSES.has(t.status)).length;

  let uptimeMetric: MetricValue;
  if (uptime.ok && uptime.monitors.length > 0) {
    const up = uptime.monitors.filter((m) => m.up).length;
    const pct = (up / uptime.monitors.length) * 100;
    uptimeMetric = {
      available: true,
      display: `${pct.toFixed(1)}% (${up}/${uptime.monitors.length} monitors up)`,
      value: pct,
      source: 'Uptime Kuma /metrics',
    };
  } else {
    uptimeMetric = {
      available: false,
      display: 'No data',
      source: 'Uptime Kuma /metrics',
      todo: `Uptime unavailable (${uptime.note ?? 'not configured'}) — set UPTIME_KUMA_API_KEY for a real availability figure.`,
    };
  }

  const hasData = total > 0 || uptimeMetric.available;
  return {
    incidents: total,
    incidentsResolved,
    uptime: uptimeMetric,
    hasData,
    live: incidents.live,
    source: 'ops.tickets (incidents) + Uptime Kuma',
    note: hasData ? incidents.note : 'no incidents and no uptime data',
  };
}

// Wins are DERIVED, never invented: shipped roadmap items + this-period changelog
// entries + resolved incidents. An empty derivation → "no data" (not a fake win).
function buildWins(
  roadmap: BoardUpdate['roadmap'],
  changelog: Sourced<ChangelogEntry>,
  incidents: Sourced<ServiceTicket>,
  period: Period,
): BoardUpdate['wins'] {
  const items: string[] = [];

  for (const s of roadmap.shipped) {
    items.push(`Shipped: ${s.title}${s.app ? ` (${s.app})` : ''}`);
  }

  for (const c of changelog.rows) {
    const when = new Date(c.date).getTime();
    if (Number.isFinite(when) && when >= period.start.getTime() && when < period.end.getTime()) {
      items.push(`Released ${c.version}${c.label ? ` — ${c.label}` : ''}`);
    }
  }

  const resolvedIncidents = incidents.rows.filter((t) => RESOLVED_STATUSES.has(t.status)).length;
  if (resolvedIncidents > 0) {
    items.push(`Resolved ${resolvedIncidents} incident${resolvedIncidents === 1 ? '' : 's'}`);
  }

  return {
    items,
    hasData: items.length > 0,
    live: roadmap.live && changelog.live,
    source: 'roadmap (shipped) + changelog + resolved incidents',
    note: items.length > 0 ? undefined : 'no wins derivable this period',
  };
}

// ---------------------------------------------------------------------------
// Top-level assembly
// ---------------------------------------------------------------------------

export async function assembleBoardUpdate(opts?: {
  now?: Date;
  deps?: Partial<AssembleDeps>;
}): Promise<BoardUpdate> {
  const now = opts?.now ?? new Date();
  const deps: AssembleDeps = { ...defaultDeps, ...(opts?.deps ?? {}) };
  const period = monthPeriod(now);

  const [roadmapSrc, ticketsSrc, incidentsSrc, changelogSrc, uptime, metrics] = await Promise.all([
    deps.getRoadmap(),
    deps.getTickets(),
    deps.getIncidents(),
    deps.getChangelog(),
    deps.getUptime(),
    deps.readRevenue(period),
  ]);

  const roadmap = buildRoadmap(roadmapSrc);
  const support = buildSupport(ticketsSrc, incidentsSrc, now);
  const ops = buildOps(incidentsSrc, uptime);
  const wins = buildWins(roadmap, changelogSrc, incidentsSrc, period);

  return {
    period: period.label,
    periodStart: period.start.toISOString(),
    generatedAt: now.toISOString(),
    metrics,
    roadmap,
    support,
    ops,
    wins,
  };
}
