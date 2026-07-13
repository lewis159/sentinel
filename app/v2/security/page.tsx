import Link from 'next/link';
import './security.css';
import '../hermes/hermes-hub.css';
import { requireSectionPage } from '@/lib/auth';
import { getFindings, getScanRuns } from '@/lib/data';
import { navIcon } from '@/components/v2/navIcon';
import { NAV } from '@/lib/v2/nav';
import SecurityBoard from '@/components/v2/SecurityBoard';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Security (posture + findings). Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// A consistent section hub header sits ABOVE the existing board — mirroring the
// Hermes hub (app/v2/hermes): a title with a live/mock status flag, a stat strip
// read from the SAME data source as the board (getFindings/getScanRuns, both
// fault-tolerant → mock-safe zeroes, never 500s), and a quick-nav card row to the
// Security nav group's pages. Reuses hermes-hub.css primitives + navIcon.
//
// The board itself (posture tiles, findings list, coverage bars, scan feed) is
// UNCHANGED below: SecurityBoard → WidgetGrid, live via GET /api/v2/security.

const isOpen = (status?: string) => (status ?? '').toLowerCase() !== 'fixed';

// Short blurbs for the Security nav group's quick-nav cards, keyed by href.
const NAV_SUB: Record<string, string> = {
  '/v2/security': 'Findings, coverage and recent scans',
  '/v2/reports': 'Exportable security & posture reports',
};

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

export default async function V2SecurityPage() {
  await requireSectionPage('security');

  // Same data source as the board — both calls are fault-tolerant (fall back to
  // mock rows / live:false, never throw), so the header is mock-safe.
  const [findingsRes, scansRes] = await Promise.all([getFindings(), getScanRuns(20)]);
  const open = findingsRes.rows.filter((f) => isOpen(f.status));
  const critical = open.filter((f) => f.severity === 'critical').length;
  const high = open.filter((f) => f.severity === 'high').length;
  const medium = open.filter((f) => f.severity === 'medium').length;
  const scanCount = scansRes.rows.length;
  const live = findingsRes.live || scansRes.live;

  // Quick-nav targets = the Security nav group (data-driven, stays in sync).
  const securityNav = NAV.find((g) => g.group === 'Security')?.items ?? [];

  return (
    <div className="hub">
      {/* Hub header */}
      <div>
        <div className="v2-eyebrow">Security · Posture</div>
        <div className="hub-title-row">
          <h1 className="v2-h1">Security</h1>
          <span className={`hub-flag${live ? ' live' : ''}`}>
            <span className="dot" aria-hidden />
            {live ? 'Live data' : 'Sample data'}
          </span>
        </div>
        <div className="v2-sub">
          Findings, scan coverage and recent runs across the estate. Jump to a
          Security workspace below, or work the board.
        </div>
      </div>

      {/* Live stat strip (same source as the board, mock-safe) */}
      <div className="hub-strip">
        <Stat
          label="Critical findings"
          value={String(critical)}
          sub="open · needs a fix"
          tone={critical > 0 ? 'crit' : 'ok'}
        />
        <Stat
          label="High findings"
          value={String(high)}
          sub="open · triage"
          tone={high > 0 ? 'high' : undefined}
        />
        <Stat label="Medium findings" value={String(medium)} sub="open · backlog" />
        <Stat
          label="Recent scans"
          value={String(scanCount)}
          sub="latest runs tracked"
        />
      </div>

      {/* Quick-nav to the Security section's pages */}
      <div className="hub-grid">
        {securityNav.map((item) => (
          <Link className="hub-card" href={item.href} key={item.href}>
            <span className="ic" aria-hidden>{navIcon(item.icon, 18)}</span>
            <span className="body">
              <span className="name">{item.label}</span>
              <span className="sub">{NAV_SUB[item.href] ?? ''}</span>
            </span>
            <span className="go" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        ))}
      </div>

      {/* Customizable widget board — unchanged */}
      <SecurityBoard />
    </div>
  );
}
