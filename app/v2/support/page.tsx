import Link from 'next/link';
import '../hermes/hermes-hub.css';
import './support.css';
import SupportTable from '@/components/v2/SupportTable';
import { NewTicketButton } from '@/components/v2/NewTicketModal';
import { requireSectionPage } from '@/lib/auth';
import { getTickets } from '@/lib/data';
import { getNeedsHumanQueue } from '@/lib/support/needs-human-view';
import { NAV } from '@/lib/v2/nav';
import { navIcon } from '@/components/v2/navIcon';

export const dynamic = 'force-dynamic';

const chips: { label: string; count: number; on?: boolean }[] = [
  { label: 'All open', count: 18, on: true },
  { label: 'Assigned to me', count: 5 },
  { label: 'SLA at risk', count: 4 },
  { label: 'Billing', count: 6 },
  { label: 'Technical', count: 9 },
];

// Statuses that take a ticket out of the "open" count (mirrors the terminal set
// used by the needs-human SQL filter).
const TERMINAL_STATUS = new Set([
  'resolved', 'closed', 'fulfilled', 'cancelled', 'canceled',
  'implemented', 'done', 'completed',
]);

// Short blurbs for the quick-nav cards, keyed by the nav item's href so the row
// stays in step with lib/v2/nav.ts (the single source for the Support group).
const NAV_SUB: Record<string, string> = {
  '/v2/support': 'The full ticket board and filters',
  '/v2/support/needs-human': 'Tickets escalated to a person',
  '/v2/support/customers': 'Accounts, history and 360 view',
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

export default async function V2SupportPage() {
  await requireSectionPage('support');

  // Mock-safe counts for the hub stat tiles. getTickets / getNeedsHumanQueue both
  // degrade to mock data (or zeroes) with no DATABASE_URL, so the header always
  // renders. No new queries — we reuse the desk's existing data sources.
  const [ticketsRes, needsHuman] = await Promise.all([
    getTickets(),
    getNeedsHumanQueue(),
  ]);
  const openCount = ticketsRes.rows.filter(
    (t) => !TERMINAL_STATUS.has(String(t.status ?? 'open').toLowerCase()),
  ).length;
  const needsHumanCount = needsHuman.rows.length;
  const slaBreaches = needsHuman.rows.filter((r) => r.slaBreached).length;
  const live = ticketsRes.live || needsHuman.live;

  // Quick-nav cards come straight from the Support nav group (single source).
  const quickNav = NAV.find((g) => g.group === 'Support')?.items ?? [];

  return (
    <div className="v2-sup-page">
      {/* Hub header — consistent with the Hermes hub: section title, a live
          (mock-safe) stat strip and a quick-nav card row. Purely additive; the
          functional desk (board header + filters + table) is untouched below. */}
      <div className="hub">
        <div>
          <div className="v2-eyebrow">Support · Section</div>
          <div className="hub-title-row">
            <h1 className="v2-h1">Support</h1>
            <span className={`hub-flag${live ? ' live' : ''}`}>
              <span className="dot" aria-hidden />
              {live ? 'Live data' : 'Sample data'}
            </span>
          </div>
          <div className="v2-sub">
            The customer desk and everything around it — the live board, the
            human-escalation queue and your accounts. Jump to a workspace below.
          </div>
        </div>

        {/* Live stat strip (mock-safe) */}
        <div className="hub-strip">
          <Stat
            label="Open tickets"
            value={String(openCount)}
            sub="on the board now"
            tone={openCount > 0 ? 'high' : undefined}
          />
          <Stat
            label="Needs human"
            value={String(needsHumanCount)}
            sub="awaiting a person"
            tone={needsHumanCount > 0 ? 'high' : undefined}
          />
          <Stat
            label="SLA breaches"
            value={String(slaBreaches)}
            sub="past resolution deadline"
            tone={slaBreaches > 0 ? 'crit' : 'ok'}
          />
        </div>

        {/* Quick-nav to the Support section pages */}
        <section className="hub-sec">
          <div className="hub-sec-h">
            <span className="ic" aria-hidden>{navIcon('support', 16)}</span>
            <h2>Jump to</h2>
            <span className="blurb">The pages in this section</span>
          </div>
          <div className="hub-grid">
            {quickNav.map((item) => (
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
        </section>
      </div>

      {/* Header */}
      <div className="spread" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="v2-eyebrow">Support</div>
          <h1 className="v2-h1">Customer desk</h1>
          <div className="v2-sub">18 open · 4 at SLA risk · assigned to you: 5</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="v2-btn ghost">Views</button>
          <NewTicketButton className="v2-btn" label="New ticket" />
        </div>
      </div>

      {/* Filter chips */}
      <div className="v2-sup-chips">
        {chips.map((c) => (
          <button key={c.label} className={`v2-sup-chip${c.on ? ' on' : ''}`}>
            {c.label} <span className="ct">· {c.count}</span>
          </button>
        ))}
      </div>

      {/* Ticket table (live via SWR) */}
      <SupportTable />
    </div>
  );
}
