import './reports.css';
import { requireSectionPage } from '@/lib/auth';
import { getTickets, getFindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Reports & analytics. Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// There is no analytics warehouse behind v2 yet, so the fabricated KPI figures,
// the ticket-volume line chart and the agent-performance bars have been removed
// rather than shown as if real. What IS derivable cheaply from the live ops
// tables is shown honestly: open-ticket and open-finding counts (getTickets /
// getFindings — DB-first, mock-safe). Everything requiring time-series history
// (MTTR, SLA %, CSAT, deflection, week-over-week trends) shows an honest
// "not available yet" state until a reporting source is wired.

const OPEN_TICKET = new Set(['open', 'in_progress', 'investigating', 'awaiting_cab', 'draft', 'building', 'planned']);
const OPEN_FINDING = (s: string) => s !== 'fixed' && s !== 'closed' && s !== 'resolved';

export default async function ReportsPage() {
  await requireSectionPage('security');

  const [{ rows: tickets, live: tLive }, { rows: findings, live: fLive }] = await Promise.all([
    getTickets(),
    getFindings(),
  ]);

  const openTickets = tickets.filter((t) => OPEN_TICKET.has(String(t.status))).length;
  const openFindings = findings.filter((f) => OPEN_FINDING(String(f.status))).length;
  const live = tLive || fLive;

  return (
    <div className="v2-rep-page">
      {/* ---------- Header ---------- */}
      <div className="v2-rep-head">
        <div>
          <div className="v2-eyebrow">Reports</div>
          <h1 className="v2-h1">Reports &amp; analytics</h1>
          <div className="v2-sub">Support, ops and agent performance across the estate</div>
        </div>
        <span className={`v2-pill ${live ? 'ok' : 'info'}`}>{live ? 'Live' : 'Mock'}</span>
      </div>

      {/* ---------- Live counts (derivable from ops tables) ---------- */}
      <div className="v2-rep-kpis">
        <div className="v2-tile t-sky">
          <div className="k">Open tickets</div>
          <div className="v">{openTickets}</div>
          <div className="meta">across all sections</div>
        </div>
        <div className="v2-tile t-high">
          <div className="k">Open findings</div>
          <div className="v">{openFindings}</div>
          <div className="meta">unresolved security findings</div>
        </div>
      </div>

      {/* ---------- Analytics not yet available ---------- */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Trends &amp; performance</h3>
        </div>
        <div style={{ padding: '28px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          Time-series analytics are not available yet. Metrics that need historical
          reporting — MTTR, SLA attainment, first-response time, ticket volume trends,
          agent deflection and CSAT — will appear here once a reporting source is wired
          to the ops tables. No figures are shown until then rather than estimated.
        </div>
      </div>
    </div>
  );
}
