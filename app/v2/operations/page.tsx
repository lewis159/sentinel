import Link from 'next/link';
import './operations.css';
import '../hermes/hermes-hub.css';
import './ops-hub.css';
import { requireSectionPage } from '@/lib/auth';
import { getActiveAlerts } from '@/lib/alertmanager';
import { getUptimeStatus } from '@/lib/uptime';
import { getTicketsByKind } from '@/lib/data';
import { navIcon } from '@/components/v2/navIcon';
import OperationsBoard from '@/components/v2/OperationsBoard';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Operations (estate monitoring). Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// The page now opens with a consistent section hub header (mirroring the Hermes
// hub): a title, a LIVE-but-mock-safe stat tile row (active alerts / open
// incidents / monitoring state — read from the monitoring clients, all of which
// return a graceful zero/unknown state when unconfigured), and a quick-nav chip
// row across the Operations section pages. Below that, the existing functional
// OperationsBoard (customizable widget board) is untouched — its tile data still
// lives inside the widget components (see components/v2/widgets/operations.tsx).

// Incident statuses considered "still open" (not terminal).
const OPEN_INCIDENT_STATUSES = new Set(['open', 'in_progress', 'investigating']);

// Quick-nav targets: the Operations section pages (mirrors the nav group).
const OPS_NAV: { label: string; href: string; icon: string }[] = [
  { label: 'Monitoring', href: '/v2/operations', icon: 'operations' },
  { label: 'Incidents', href: '/v2/incidents', icon: 'incidents' },
  { label: 'Requests', href: '/v2/requests', icon: 'requests' },
  { label: 'Changes', href: '/v2/changes', icon: 'changes' },
  { label: 'Problems', href: '/v2/problems', icon: 'problems' },
  { label: 'Releases', href: '/v2/releases', icon: 'releases' },
  { label: 'Components', href: '/v2/components', icon: 'components' },
  { label: 'Scans', href: '/v2/scans', icon: 'scans' },
  { label: 'Resilience', href: '/v2/resilience', icon: 'resilience' },
  { label: 'Alerts', href: '/v2/alerts', icon: 'alerts' },
  { label: 'Activity', href: '/v2/activity', icon: 'activity' },
  { label: 'Roadmap', href: '/v2/roadmap', icon: 'roadmap' },
  { label: 'Changelog', href: '/v2/changelog', icon: 'changelog' },
  { label: 'Testing', href: '/v2/testing', icon: 'testing' },
];

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'high' | 'crit';
}) {
  return (
    <div className="hub-stat">
      <div className="lab">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export default async function OperationsPage() {
  await requireSectionPage('operations');

  // All three reads are mock-safe: the monitoring clients catch and return an
  // { ok:false } state rather than throwing, and getTicketsByKind falls back to
  // mock rows (unscoped operator view) when there's no DB.
  const [alerts, uptime, incidents] = await Promise.all([
    getActiveAlerts(),
    getUptimeStatus(),
    getTicketsByKind('incident'),
  ]);

  // Active alerts — total firing, critical highlighted.
  const alertTotal = alerts.alerts.length;
  const alertCrit = alerts.groups.critical;
  const alertWarn = alerts.groups.warning;
  const alertsSub = alerts.ok
    ? alertTotal === 0
      ? 'all clear'
      : `${alertCrit} critical · ${alertWarn} warning`
    : alerts.note ?? 'unreachable';
  const alertsTone: 'ok' | 'high' | 'crit' | undefined = !alerts.ok
    ? undefined
    : alertCrit > 0
      ? 'crit'
      : alertWarn > 0
        ? 'high'
        : 'ok';

  // Open incidents — non-terminal incident tickets.
  const openIncidents = incidents.rows.filter((t) =>
    OPEN_INCIDENT_STATUSES.has(String(t.status)),
  ).length;

  // Monitoring / uptime — up vs total monitors.
  const upTotal = uptime.monitors.length;
  const upCount = uptime.monitors.filter((m) => m.up).length;
  const monValue = uptime.ok ? `${upCount}/${upTotal}` : '—';
  const monSub = uptime.ok
    ? upTotal === 0
      ? 'no monitors'
      : upCount === upTotal
        ? 'all up'
        : `${upTotal - upCount} down`
    : uptime.note ?? 'not configured';
  const monTone: 'ok' | 'high' | 'crit' | undefined = !uptime.ok
    ? undefined
    : upTotal === 0
      ? undefined
      : upCount === upTotal
        ? 'ok'
        : 'crit';

  return (
    <div className="hub">
      {/* Section hub header */}
      <div>
        <div className="v2-eyebrow">Operations</div>
        <div className="hub-title-row">
          <h1 className="v2-h1">Operations</h1>
          <span className={`hub-flag${alerts.ok ? ' live' : ''}`}>
            <span className="dot" aria-hidden />
            {alerts.ok ? 'Monitoring live' : 'Monitoring mock'}
          </span>
        </div>
        <div className="v2-sub">
          Estate monitoring and the ITIL service desk — one section for alerts,
          incidents, changes, releases and resilience. Jump to a workspace below,
          or work the live board.
        </div>
      </div>

      {/* Live stat strip (monitoring clients, mock-safe) */}
      <div className="hub-strip">
        <Stat
          label="Active alerts"
          value={String(alertTotal)}
          sub={alertsSub}
          tone={alertsTone}
        />
        <Stat
          label="Open incidents"
          value={String(openIncidents)}
          sub={openIncidents === 0 ? 'none open' : 'need attention'}
          tone={openIncidents > 0 ? 'high' : 'ok'}
        />
        <Stat
          label="Monitoring"
          value={monValue}
          sub={monSub}
          tone={monTone}
        />
      </div>

      {/* Quick-nav across the Operations section pages */}
      <nav className="ops-nav" aria-label="Operations sections">
        {OPS_NAV.map((n) => (
          <Link className="ops-chip" href={n.href} key={n.href}>
            <span className="ic" aria-hidden>{navIcon(n.icon, 15)}</span>
            {n.label}
          </Link>
        ))}
      </nav>

      {/* Existing functional widget board — untouched */}
      <OperationsBoard />
    </div>
  );
}
