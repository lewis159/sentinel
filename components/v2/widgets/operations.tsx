'use client';

// -----------------------------------------------------------------------------
// Operations widgets — self-contained tiles for the v2 Operations board.
//
// Each component renders ONLY its inner content (no card wrapper); the widget
// grid panel supplies the frame + title. Data is LIVE: widgets read from a
// shared SWR hook (GET /api/v2/operations). All widgets share the same SWR key
// so they dedupe to ONE request per poll. The polling interval is supplied by an
// ancestor <SWRConfig> (RefreshProvider), so no interval is set here.
//
// REAL fields (from the API → lib/data): the incidents list and the tonight
// change window. cpu / memory / services / disk / uptime are static placeholders
// (no live infra source is wired into the route yet).
// -----------------------------------------------------------------------------

import useSWR from 'swr';
import type { Layout } from 'react-grid-layout';
import type { PlacedWidget } from '@/components/widgets/registry';

// ---- Response shape (defined inline here; mirrors app/api/v2/operations) ----
type OpsService = { name: string; status: 'ok' | 'degraded' | 'down'; replicas: string; uptime: string };
type OpsIncident = { ref: string; priority: 'P1' | 'P2' | 'P3' | 'P4'; title: string; age: string };
type OpsChangeWindow = { ref: string; title: string; when: string } | null;
type OpsDisk = { mount: string; pct: number };

type OperationsData = {
  live: boolean;
  cpu: { pct: number; samples: number[] };
  memory: { pct: number; samples: number[] };
  services: OpsService[];
  incidents: OpsIncident[];
  changeWindow: OpsChangeWindow;
  uptime: { pct: number; slo: number };
  disk: OpsDisk[];
};

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Shared hook — every widget calls this; SWR dedupes to a single request per
// poll interval since they all use the same key.
function useOperations() {
  return useSWR<OperationsData>('/api/v2/operations', fetcher);
}

// Subtle placeholder shown while the first response is in flight.
const LOADING = '…';

// ---------------------------------------------------------------------------
// Sparkline geometry — build an SVG polyline ("line") and closed area ("area")
// from 0–100 samples. Copied from the original operations page.
// ---------------------------------------------------------------------------
const W = 132;
const H = 44;
const PAD = 4;

function spark(samples: number[]): { line: string; area: string } {
  const n = samples.length;
  if (n === 0) return { line: '', area: '' };
  const span = W - PAD * 2;
  const usable = H - PAD * 2;
  const pts = samples.map((v, i) => {
    const x = PAD + (n === 1 ? 0 : (span * i) / (n - 1));
    const y = PAD + usable * (1 - Math.max(0, Math.min(100, v)) / 100);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  return { line, area };
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------
export function CpuWidget() {
  const { data } = useOperations();
  const samples = data?.cpu.samples ?? [];
  const { line, area } = spark(samples);
  return (
    <div className="v2-op-w">
      <div className="v2-op-metric-top">
        <div>
          <div className="v2-op-big">{data ? `${data.cpu.pct}%` : LOADING}</div>
          <div className="v2-op-bigsub">load 1.8</div>
        </div>
        <svg
          className="v2-op-spark"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={area} fill="var(--accent)" fillOpacity={0.12} />
          <polyline
            points={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export function MemoryWidget() {
  const { data } = useOperations();
  const samples = data?.memory.samples ?? [];
  const { line, area } = spark(samples);
  return (
    <div className="v2-op-w">
      <div className="v2-op-metric-top">
        <div>
          <div className="v2-op-big">{data ? `${data.memory.pct}%` : LOADING}</div>
          <div className="v2-op-bigsub">19.5 / 32 GB</div>
        </div>
        <svg
          className="v2-op-spark"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={area} fill="var(--ok)" fillOpacity={0.12} />
          <polyline
            points={line}
            fill="none"
            stroke="var(--ok)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
// Map the API status to the CSS dot token (ok | wn | rd).
function statusDot(status: OpsService['status']): 'ok' | 'wn' | 'rd' {
  if (status === 'down') return 'rd';
  if (status === 'degraded') return 'wn';
  return 'ok';
}

export function ServicesWidget() {
  const { data } = useOperations();
  const services = data?.services;
  if (!services) {
    return <div className="v2-op-empty" style={{ padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>{LOADING}</div>;
  }
  return (
    <div>
      {services.map((s) => (
        <div className="v2-op-svc" key={s.name}>
          <span className={`v2-op-dot ${statusDot(s.status)}`} />
          <span className="v2-op-svc-name">{s.name}</span>
          <span className="v2-op-svc-rep">{s.replicas}</span>
          <span className="v2-op-svc-up">{s.uptime}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open incidents
// ---------------------------------------------------------------------------
// P-band → pill token: P1 = crit, P2/P3 = high, P4 = info.
function incPill(priority: OpsIncident['priority']): string {
  if (priority === 'P1') return 'crit';
  if (priority === 'P4') return 'info';
  return 'high';
}

export function OpenIncidentsWidget() {
  const { data } = useOperations();
  const incidents = data?.incidents;
  if (!incidents) {
    return <div className="v2-op-empty" style={{ padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>{LOADING}</div>;
  }
  if (incidents.length === 0) {
    return <div className="v2-op-empty" style={{ padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>No open incidents.</div>;
  }
  return (
    <div>
      {incidents.map((inc) => (
        <div className="v2-op-inc" key={inc.ref}>
          <span className={`v2-pill ${incPill(inc.priority)}`}>{inc.priority}</span>
          <div>
            <div className="v2-op-inc-t">{inc.title}</div>
            <div className="v2-op-inc-meta">{`${inc.ref} · ${inc.age}`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change window
// ---------------------------------------------------------------------------
export function ChangeWindowWidget() {
  const { data } = useOperations();
  const cw = data?.changeWindow;

  if (!data) {
    return (
      <div className="v2-op-chg v2-op-chg--solo">
        <span className="v2-op-chg-lab">Change window</span>
        <span className="v2-op-chg-b">{LOADING}</span>
      </div>
    );
  }
  if (!cw) {
    return (
      <div className="v2-op-chg v2-op-chg--solo">
        <span className="v2-op-chg-lab">Change window</span>
        <span className="v2-op-chg-b">None scheduled</span>
      </div>
    );
  }
  return (
    <div className="v2-op-chg v2-op-chg--solo">
      <span className="v2-op-chg-lab">Change window</span>
      <span className="v2-op-chg-b">
        <b>{cw.ref}</b> · {cw.title}
      </span>
      <span className="v2-pill info" style={{ marginLeft: 'auto' }}>{cw.when}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uptime (NEW — catalog only)
// ---------------------------------------------------------------------------
export function UptimeWidget() {
  const { data } = useOperations();
  const up = data?.uptime;
  return (
    <div className="v2-op-w">
      <div className="v2-op-big">{up ? `${up.pct}%` : LOADING}</div>
      <div className="v2-op-bigsub">uptime · 30d</div>
      <div className="v2-op-slo">
        <span className="v2-op-slo-dot" />
        {up ? <>SLO {up.slo}% · <b>within budget</b> · 26m of 43m spent</> : 'SLO …'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disk (NEW — catalog only)
// ---------------------------------------------------------------------------
// Derive the fill colour from utilisation (no explicit state in the API).
function diskColor(pct: number): string {
  if (pct >= 95) return 'var(--crit)';
  if (pct >= 85) return 'var(--high)';
  return 'var(--ok)';
}

export function DiskWidget() {
  const { data } = useOperations();
  const mounts = data?.disk;
  if (!mounts) {
    return <div className="v2-op-w" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{LOADING}</div>;
  }
  return (
    <div className="v2-op-w">
      {mounts.map((m) => (
        <div className="v2-op-disk-row" key={m.mount}>
          <div className="v2-op-disk-head">
            <span className="v2-op-disk-name">{m.mount}</span>
            <span className="v2-op-disk-pct">{m.pct}%</span>
          </div>
          <span className="v2-op-disk-track">
            <span
              className="v2-op-disk-fill"
              style={{ width: `${m.pct}%`, background: diskColor(m.pct) }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Catalog + defaults
// -----------------------------------------------------------------------------

export const OPS_CATALOG: PlacedWidget[] = [
  {
    id: 'cpu',
    title: 'CPU',
    component: CpuWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'memory',
    title: 'Memory',
    component: MemoryWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'services',
    title: 'Services',
    component: ServicesWidget,
    defaultSize: { w: 6, h: 9 },
    minSize: { w: 4, h: 6 },
  },
  {
    id: 'incidents',
    title: 'Open incidents',
    component: OpenIncidentsWidget,
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 4, h: 4 },
  },
  {
    id: 'change-window',
    title: 'Change window',
    component: ChangeWindowWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  {
    id: 'uptime',
    title: 'Uptime',
    component: UptimeWidget,
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'disk',
    title: 'Disk usage',
    component: DiskWidget,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 5 },
  },
];

// Widgets shown on a fresh board. Uptime + Disk live in the catalog but are NOT
// active by default, so the user can add them.
export const OPS_DEFAULT_ACTIVE: string[] = [
  'cpu',
  'memory',
  'services',
  'incidents',
  'change-window',
];

// 12-col layout for the default-active widgets.
export const OPS_DEFAULT_LAYOUT: Layout[] = [
  { i: 'cpu', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 4 },
  { i: 'memory', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 4 },
  { i: 'services', x: 0, y: 4, w: 6, h: 9, minW: 4, minH: 6 },
  { i: 'incidents', x: 6, y: 4, w: 6, h: 6, minW: 4, minH: 4 },
  { i: 'change-window', x: 6, y: 10, w: 6, h: 4, minW: 4, minH: 3 },
];
