'use client';

// -----------------------------------------------------------------------------
// Security widgets — self-contained tiles for the v2 Security board.
//
// Each component renders ONLY its inner content (no card wrapper); the widget
// grid panel supplies the frame + title. Data is LIVE: widgets read from a
// shared SWR hook (GET /api/v2/security). All widgets share the same SWR key so
// they dedupe to ONE request per poll. The polling interval is supplied by an
// ancestor <SWRConfig> (RefreshProvider), so no interval is set here.
// -----------------------------------------------------------------------------

import Link from 'next/link';
import useSWR from 'swr';
import type { Layout } from 'react-grid-layout';
import type { PlacedWidget } from '@/components/widgets/registry';

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Inline mirror of the GET /api/v2/security response contract (kept local — the
// route owns the canonical shape; this is the client's view of it).
type SecKpis = { critical: number; high: number; medium: number; resolved30d: number };
type SecFinding = {
  ref: string; title: string; severity: string;
  component: string; cwe: string; pill: string;
};
type SecBar = { lab: string; pct: number; color: string };
type SecScan = { id: string; type: string; findings: string; when: string; pill: string };
type SecurityData = {
  live: boolean;
  kpis: SecKpis;
  findings: SecFinding[];
  coverage: SecBar[];
  scans: SecScan[];
  posture: { score: number };
};

// Shared hook — every widget calls this; SWR dedupes to a single request per
// poll interval since they all use the same key.
function useSecurity() {
  return useSWR<SecurityData>('/api/v2/security', fetcher);
}

// Subtle placeholder shown while the first response is in flight.
const LOADING = '…';

// A thin coloured top-to-bottom stripe on the left edge of a KPI body — replaces
// the .v2-tile accent bar since widgets no longer carry the outer tile box.
function Stripe({ tint }: { tint: string }) {
  return (
    <span
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: tint }}
    />
  );
}

// Shared KPI body: coloured stripe + big number + meta line. The panel header
// already shows the widget title, so the body omits the label.
function Kpi({ tint, value, meta }: { tint: string; value: string; meta: string }) {
  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: 10,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Stripe tint={tint} />
      <div className="v">{value}</div>
      <div className="meta">{meta}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// KPIs — critical / high / medium / resolved
// -----------------------------------------------------------------------------

export function SecKpiCritical() {
  const { data } = useSecurity();
  const v = data?.kpis.critical;
  return (
    <Kpi tint="var(--crit)" value={v != null ? String(v) : LOADING} meta="needs immediate action" />
  );
}

export function SecKpiHigh() {
  const { data } = useSecurity();
  const v = data?.kpis.high;
  return (
    <Kpi tint="var(--high)" value={v != null ? String(v) : LOADING} meta="open · unremediated" />
  );
}

export function SecKpiMedium() {
  const { data } = useSecurity();
  const v = data?.kpis.medium;
  return (
    <Kpi tint="var(--muted)" value={v != null ? String(v) : LOADING} meta="tracked · lower priority" />
  );
}

export function SecKpiResolved() {
  const { data } = useSecurity();
  const v = data?.kpis.resolved30d;
  return (
    <Kpi tint="var(--ok)" value={v != null ? String(v) : LOADING} meta="fixed & verified" />
  );
}

// -----------------------------------------------------------------------------
// Open findings — severity pill + title + ref/component/cwe meta
// -----------------------------------------------------------------------------

export function OpenFindings() {
  const { data } = useSecurity();

  if (!data) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Loading…</div>
    );
  }

  const items = data.findings ?? [];
  if (items.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>No open findings.</div>
    );
  }

  return (
    <div>
      {items.map((f) => (
        <Link key={f.ref} href={`/v2/security/findings/${f.ref}`} className="v2-sec-row">
          <span className={`v2-pill ${f.pill}`}>{f.severity}</span>
          <div>
            <div className="t">{f.title}</div>
            <div className="m">
              {f.ref} · {f.component}
              {f.cwe ? ` · ${f.cwe}` : ''}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Scan coverage — horizontal bars
// -----------------------------------------------------------------------------

export function ScanCoverage() {
  const { data } = useSecurity();
  const bars = data?.coverage ?? [];
  return (
    <div style={{ padding: 16 }}>
      <div className="v2-bars">
        {bars.map((b) => (
          <div key={b.lab} className="v2-bar-row">
            <span className="lab">{b.lab}</span>
            <span className="v2-track">
              <span className="v2-fill" style={{ width: `${b.pct}%`, background: b.color }} />
            </span>
            <span className="n">{b.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Recent scans — run id + type + outcome pill + relative time
// -----------------------------------------------------------------------------

export function RecentScans() {
  const { data } = useSecurity();

  if (!data) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Loading…</div>
    );
  }

  const scans = data.scans ?? [];
  if (scans.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>No recent scans.</div>
    );
  }

  return (
    <div>
      {scans.map((run) => (
        <div key={run.id} className="v2-sec-scan">
          <span className="id">#{run.id}</span>
          <span className="ty">{run.type}</span>
          <span className={`v2-pill ${run.pill}`}>{run.findings}</span>
          <span className="when">{run.when}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Catalog + defaults
// -----------------------------------------------------------------------------

export const SEC_CATALOG: PlacedWidget[] = [
  {
    id: 'sec-kpi-critical',
    title: 'Critical',
    component: SecKpiCritical,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'sec-kpi-high',
    title: 'High',
    component: SecKpiHigh,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'sec-kpi-medium',
    title: 'Medium',
    component: SecKpiMedium,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'sec-kpi-resolved',
    title: 'Resolved 30d',
    component: SecKpiResolved,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'sec-open-findings',
    title: 'Open findings',
    component: OpenFindings,
    defaultSize: { w: 8, h: 9 },
    minSize: { w: 4, h: 6 },
  },
  {
    id: 'sec-scan-coverage',
    title: 'Scan coverage',
    component: ScanCoverage,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'sec-recent-scans',
    title: 'Recent scans',
    component: RecentScans,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
  },
];

// The widgets shown on a fresh board (all of them for Security).
export const SEC_DEFAULT_ACTIVE: string[] = [
  'sec-kpi-critical',
  'sec-kpi-high',
  'sec-kpi-medium',
  'sec-kpi-resolved',
  'sec-open-findings',
  'sec-scan-coverage',
  'sec-recent-scans',
];

// 12-col layout for the default-active widgets.
export const SEC_DEFAULT_LAYOUT: Layout[] = [
  { i: 'sec-kpi-critical', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'sec-kpi-high', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'sec-kpi-medium', x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'sec-kpi-resolved', x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'sec-open-findings', x: 0, y: 3, w: 8, h: 9, minW: 4, minH: 6 },
  { i: 'sec-scan-coverage', x: 8, y: 3, w: 4, h: 5, minW: 3, minH: 4 },
  { i: 'sec-recent-scans', x: 8, y: 8, w: 4, h: 5, minW: 3, minH: 4 },
];
