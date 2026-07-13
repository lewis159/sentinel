import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { getObservability } from '@/lib/observability/metrics';
import { navIcon } from '@/components/v2/navIcon';
import './hermes-hub.css';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Hermes hub. The landing page for the agent platform: a header
// with the Brain flag + spine-live status, a stat strip read LIVE from the P3
// spine (getObservability — mock-safe zeroes when there's no DB), and four
// themed card sections (Command / Growth / Knowledge / Ops) mirroring the rail's
// hermes sub-groups. Every card links to a real, section-gated feature page.
// Gated by the same `hermes` section as the rest of the console.

type Card = { name: string; href: string; icon: string; sub: string };
type CardSection = { title: string; blurb: string; icon: string; cards: Card[] };

const SECTIONS: CardSection[] = [
  {
    title: 'Command',
    blurb: 'Run the floor, clear approvals and shape the roster.',
    icon: 'cpu',
    cards: [
      { name: 'Floor', href: '/v2/hermes/floor', icon: 'floor', sub: 'Live agent activity, thread by thread' },
      { name: 'Approvals', href: '/v2/hermes/approvals', icon: 'approvals', sub: 'Decide what the agents may act on' },
      { name: 'Agents', href: '/v2/hermes/agents', icon: 'agents', sub: 'The roster and what each one owns' },
      { name: 'Agent builder', href: '/v2/hermes/agent-builder', icon: 'agent-builder', sub: 'Compose a new agent from tools + policy' },
      { name: 'Governance', href: '/v2/hermes/governance', icon: 'governance', sub: 'Autonomy, budget and escalation dials' },
    ],
  },
  {
    title: 'Growth',
    blurb: 'Keep customers, win new ones and read the numbers.',
    icon: 'trending-up',
    cards: [
      { name: 'Churn save', href: '/v2/hermes/churn-save', icon: 'churn', sub: 'Win-back plays for at-risk accounts' },
      { name: 'Onboarding', href: '/v2/hermes/onboarding', icon: 'onboarding', sub: 'Guide new customers to first value' },
      { name: 'Leads', href: '/v2/hermes/leads', icon: 'leads', sub: 'Qualified inbound, triaged and scored' },
      { name: 'Health digest', href: '/v2/hermes/health-digest', icon: 'health', sub: 'Account health scores at a glance' },
      { name: 'Forecasting', href: '/v2/hermes/forecasting', icon: 'forecasting', sub: 'Revenue and pipeline projections' },
      { name: 'Board update', href: '/v2/hermes/board-update', icon: 'board', sub: 'A drafted brief for the board' },
    ],
  },
  {
    title: 'Knowledge',
    blurb: 'Answer, author and mine what customers are asking for.',
    icon: 'book',
    cards: [
      { name: 'Knowledge Q&A', href: '/v2/hermes/knowledge', icon: 'knowledge', sub: 'Ask across the estate knowledge base' },
      { name: 'KB authoring', href: '/v2/hermes/kb-authoring', icon: 'kb-authoring', sub: 'Draft and refine help articles' },
      { name: 'Feature requests', href: '/v2/hermes/feature-requests', icon: 'feature-requests', sub: 'Clustered asks from real conversations' },
      { name: 'Market & content', href: '/v2/hermes/market', icon: 'market', sub: 'Market signal and content drafts' },
    ],
  },
  {
    title: 'Ops',
    blurb: 'Command incidents, watch the spine and prove it works.',
    icon: 'server-cog',
    cards: [
      { name: 'Incident commander', href: '/v2/hermes/incident-commander', icon: 'incident-commander', sub: 'Coordinate a live incident response' },
      { name: 'Observability', href: '/v2/hermes/observability', icon: 'observability', sub: 'Proposals, executions, budget and audit' },
      { name: 'Integrations', href: '/v2/hermes/integrations', icon: 'plug', sub: 'Estate secrets, flags and connectors' },
      { name: 'Testing', href: '/v2/hermes/testing', icon: 'testing', sub: 'Exercise agents against fixtures' },
    ],
  },
];

const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;

function pressure(pct: number): 'ok' | 'high' | 'crit' {
  if (pct >= 100) return 'crit';
  if (pct >= 70) return 'high';
  return 'ok';
}

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

export default async function HermesHubPage() {
  await requireSectionPage('hermes');

  const [brainOn, { proposals, executions, budget, audit, live }] = await Promise.all([
    getRuntimeFlag('HERMES_BRAIN_ENABLED'),
    getObservability(),
  ]);

  return (
    <div className="hub">
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Hermes · Platform</div>
        <div className="hub-title-row">
          <h1 className="v2-h1">Hermes</h1>
          <span className={`hub-flag${brainOn ? ' on' : ''}`}>
            <span className="dot" aria-hidden />
            {brainOn ? 'Brain online' : 'Brain dormant'}
          </span>
          <span className={`hub-flag${live ? ' live' : ''}`}>
            <span className="dot" aria-hidden />
            {live ? 'Spine live' : 'No data yet'}
          </span>
        </div>
        <div className="v2-sub">
          One control surface for the agent platform — the floor, the safety
          spine and every department the Brain runs. Pick a workspace below.
        </div>
      </div>

      {/* Live stat strip (P3 spine, mock-safe) */}
      <div className="hub-strip">
        <Stat
          label="Pending proposals"
          value={String(proposals.pending)}
          sub="awaiting a human"
          tone={proposals.pending > 0 ? 'high' : undefined}
        />
        <Stat
          label="Executions"
          value={String(executions.total)}
          sub={`${executions.failed} failed`}
          tone={executions.failed > 0 ? 'crit' : undefined}
        />
        <Stat
          label="Budget used"
          value={`${budget.overallUtilisationPct}%`}
          sub={`${money(budget.totalSpentMinor)} / ${money(budget.totalCapMinor)}`}
          tone={pressure(budget.overallUtilisationPct)}
        />
        <Stat
          label="Audit chain"
          value={audit.chain.ok ? 'OK' : 'BROKEN'}
          sub={`${audit.chain.count} events`}
          tone={audit.chain.ok ? 'ok' : 'crit'}
        />
      </div>

      {/* Themed card sections */}
      {SECTIONS.map((sec) => (
        <section className="hub-sec" key={sec.title}>
          <div className="hub-sec-h">
            <span className="ic" aria-hidden>{navIcon(sec.icon, 16)}</span>
            <h2>{sec.title}</h2>
            <span className="blurb">{sec.blurb}</span>
          </div>
          <div className="hub-grid">
            {sec.cards.map((c) => (
              <Link className="hub-card" href={c.href} key={c.href}>
                <span className="ic" aria-hidden>{navIcon(c.icon, 18)}</span>
                <span className="body">
                  <span className="name">{c.name}</span>
                  <span className="sub">{c.sub}</span>
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
      ))}
    </div>
  );
}
