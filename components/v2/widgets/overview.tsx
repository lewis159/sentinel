'use client';

// -----------------------------------------------------------------------------
// Overview widgets — self-contained tiles for the v2 Estate overview board.
//
// Each component renders ONLY its inner content (no card wrapper); the widget
// grid panel supplies the frame + title. Data is LIVE: widgets read from a
// shared SWR hook (GET /api/v2/overview). All widgets share the same SWR key so
// they dedupe to ONE request per poll. The polling interval is supplied by an
// ancestor <SWRConfig> (RefreshProvider), so no interval is set here.
// -----------------------------------------------------------------------------

import useSWR from 'swr';
import type { Layout } from 'react-grid-layout';
import type { PlacedWidget } from '@/components/widgets/registry';
import type { OverviewData, AttentionItem } from '@/lib/v2/api-types';

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Shared hook — every widget calls this; SWR dedupes to a single request per
// poll interval since they all use the same key.
function useOverview() {
  return useSWR<OverviewData>('/api/v2/overview', fetcher);
}

// A thin coloured top stripe — replaces the .v2-tile::before accent bar since
// widgets no longer carry the outer .v2-tile box (the panel is the box now).
function Stripe({ tint }: { tint: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        background: tint,
      }}
    />
  );
}

// Shared KPI body: coloured stripe + label + big number + meta line.
function Kpi({
  tint,
  label,
  value,
  meta,
}: {
  tint: string;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    // The panel header already shows the widget title, so the body omits the
    // label (was a duplicate) and shows just the value + meta.
    <div style={{ position: 'relative', paddingLeft: 10, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Stripe tint={tint} />
      <div className="v">{value}</div>
      <div className="meta">{meta}</div>
    </div>
  );
}

// Subtle placeholder shown while the first response is in flight.
const LOADING = '…';

export function KpiIncidents() {
  const { data } = useOverview();
  const kpi = data?.kpis.incidents;
  return (
    <Kpi tint="var(--crit)" label="Open incidents" value={kpi?.value ?? LOADING} meta={kpi?.meta ?? ''} />
  );
}

export function KpiFindings() {
  const { data } = useOverview();
  const kpi = data?.kpis.findings;
  return (
    <Kpi tint="var(--high)" label="Critical findings" value={kpi?.value ?? LOADING} meta={kpi?.meta ?? ''} />
  );
}

export function KpiSla() {
  const { data } = useOverview();
  const kpi = data?.kpis.sla;
  return (
    <Kpi tint="var(--sky)" label="SLA at risk" value={kpi?.value ?? LOADING} meta={kpi?.meta ?? ''} />
  );
}

export function KpiServices() {
  const { data } = useOverview();
  const kpi = data?.kpis.services;
  return (
    <Kpi tint="var(--ok)" label="Services healthy" value={kpi?.value ?? LOADING} meta={kpi?.meta ?? ''} />
  );
}

// -----------------------------------------------------------------------------
// Needs attention feed
// -----------------------------------------------------------------------------

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <a href={item.href} className="v2-fitem" style={{ ['--tint' as any]: item.tint, textDecoration: 'none', color: 'inherit' }}>
      <span className="sev" />
      <div>
        <div className="t">{item.title}</div>
        <div className="d">
          <span className={`v2-src ${item.src}`}>{item.srcLabel}</span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{item.ref}</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 5,
        }}
      >
        <span className={`v2-pill ${item.pill}`}>{item.pillLabel}</span>
        <span className="age">{item.age}</span>
      </div>
    </a>
  );
}

export function AttentionFeed() {
  const { data } = useOverview();

  if (!data) {
    return (
      <div className="v2-feed">
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Loading…</div>
      </div>
    );
  }

  const items = data.attention ?? [];
  if (items.length === 0) {
    return (
      <div className="v2-feed">
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Nothing needs attention.</div>
      </div>
    );
  }

  return (
    <div className="v2-feed">
      {items.map((item) => (
        <AttentionRow key={item.key} item={item} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Security posture — donut + coverage bars
// -----------------------------------------------------------------------------

export function SecurityPosture() {
  const { data } = useOverview();
  const score = data?.posture.score ?? 0;
  const bars = data?.posture.bars ?? [];
  const dashoffset = 314 - (314 * score) / 100;

  return (
    <div style={{ padding: 16, display: 'flex', gap: 18, alignItems: 'center' }}>
      <div className="v2-donut">
        <svg width={92} height={92} viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface2)" strokeWidth="11" />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray="314"
            strokeDashoffset={dashoffset}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="lab">
          <b>{data ? score : LOADING}</b>
          <span>/ 100</span>
        </div>
      </div>
      <div className="v2-bars" style={{ flex: 1 }}>
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
// Support queues
// -----------------------------------------------------------------------------

export function SupportQueues() {
  const { data } = useOverview();
  const queues = data?.queues ?? [];
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {queues.map((q) => (
        <div
          key={q.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>{q.name}</span>
          <span className={`v2-pill ${q.pill}`}>{q.pillLabel}</span>
          <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{q.count}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Estate health — uptime headline + service rows (NEW)
// -----------------------------------------------------------------------------

type Service = { name: string; up: boolean; label: string };

const SERVICES: Service[] = [
  { name: 'web-portal', up: true, label: 'up' },
  { name: 'api-gateway', up: true, label: 'up' },
  { name: 'worker-pool', up: true, label: 'up' },
  { name: 'db-primary', up: false, label: 'degraded' },
  { name: 'object-store', up: true, label: 'up' },
];

export function EstateHealth() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1 }}>
          99.94%
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>uptime · 30d</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SERVICES.map((s) => (
          <div
            key={s.name}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: s.up ? 'var(--ok)' : 'var(--high)',
              }}
            />
            <span style={{ flex: 1 }}>{s.name}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: s.up ? 'var(--ok)' : 'var(--high)',
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Recent activity — recent activity lines (NEW)
// -----------------------------------------------------------------------------

type Activity = { key: string; tint: string; text: string; time: string };

const ACTIVITY: Activity[] = [
  { key: 'a1', tint: 'var(--ok)', text: 'Deploy web-portal v2.14.0 succeeded', time: '4m' },
  { key: 'a2', tint: 'var(--crit)', text: 'INC-204 opened on db-primary', time: '12m' },
  { key: 'a3', tint: 'var(--accent)', text: 'SUP-1188 assigned to billing', time: '48m' },
  { key: 'a4', tint: 'var(--high)', text: 'Scan flagged 3 new findings', time: '2h' },
];

export function RecentActivity() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ACTIVITY.map((a) => (
        <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flexShrink: 0,
              background: a.tint,
            }}
          />
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text)' }}>{a.text}</span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{a.time}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Catalog + defaults
// -----------------------------------------------------------------------------

export const OVERVIEW_CATALOG: PlacedWidget[] = [
  {
    id: 'kpi-incidents',
    title: 'Open incidents',
    component: KpiIncidents,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'kpi-findings',
    title: 'Critical findings',
    component: KpiFindings,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'kpi-sla',
    title: 'SLA at risk',
    component: KpiSla,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'kpi-services',
    title: 'Services healthy',
    component: KpiServices,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'attention-feed',
    title: 'Needs attention',
    component: AttentionFeed,
    defaultSize: { w: 8, h: 11 },
    minSize: { w: 4, h: 6 },
  },
  {
    id: 'security-posture',
    title: 'Security posture',
    component: SecurityPosture,
    defaultSize: { w: 4, h: 7 },
    minSize: { w: 3, h: 6 },
  },
  {
    id: 'support-queues',
    title: 'Support queues',
    component: SupportQueues,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'estate-health',
    title: 'Estate health',
    component: EstateHealth,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 5 },
  },
  {
    id: 'recent-activity',
    title: 'Recent activity',
    component: RecentActivity,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 5 },
  },
];

// The widgets shown on a fresh board. EstateHealth + RecentActivity live in the
// catalog but are NOT active by default, so the user can add them.
export const DEFAULT_ACTIVE: string[] = [
  'kpi-incidents',
  'kpi-findings',
  'kpi-sla',
  'kpi-services',
  'attention-feed',
  'security-posture',
  'support-queues',
];

// 12-col layout for the default-active widgets.
export const DEFAULT_LAYOUT: Layout[] = [
  { i: 'kpi-incidents', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'kpi-findings', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'kpi-sla', x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'kpi-services', x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 3 },
  { i: 'attention-feed', x: 0, y: 3, w: 8, h: 11, minW: 4, minH: 6 },
  { i: 'security-posture', x: 8, y: 3, w: 4, h: 7, minW: 3, minH: 6 },
  { i: 'support-queues', x: 8, y: 10, w: 4, h: 5, minW: 3, minH: 4 },
];
