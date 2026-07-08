import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { TicketComposer, TicketStatusControl } from '@/components/v2/ticket-actions';
import HermesPanel from '@/components/v2/HermesPanel';
import './incident.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Static incident-response view modelled on INC-204 "Postgres primary —
// connection pool exhausted". The route ref is echoed into the title and the
// timeline so the page reads coherently for any incident reference. Content is
// plausible mock data (no live source), consistent with the support detail page.
// ---------------------------------------------------------------------------

type EvColour = 'rd' | 'bl' | 'am' | 'pu';
type EvTag = { kind: 'auto' | 'wait' | 'draft'; label: string };
type SvcState = 'ok' | 'degraded' | 'down';
type LinkType = 'finding' | 'change' | 'ticket' | 'kb';

interface TimelineEvent {
  dot: EvColour;
  text: string;
  time: string;
  tag?: EvTag;
}

const EVENTS: TimelineEvent[] = [
  {
    dot: 'rd',
    text: 'Monitoring detected pool at 100% · alert fired',
    time: '12m ago',
  },
  {
    dot: 'bl',
    text: 'Hermes · Support auto-triaged → opened {ref}, paged Escalations',
    time: '11m ago',
    tag: { kind: 'auto', label: 'Autonomous' },
  },
  {
    dot: 'bl',
    text: 'Hermes · CTO traced cause: batch job holding connections',
    time: '8m ago',
  },
  {
    dot: 'am',
    text: 'CTO proposed CHG-088 — raise pool limit 20→40, kill stuck job',
    time: '6m ago',
    tag: { kind: 'wait', label: 'Awaiting your approval' },
  },
  {
    dot: 'pu',
    text: 'Hermes · Support posted status to affected customers',
    time: '5m ago',
    tag: { kind: 'draft', label: 'Draft sent for review' },
  },
  {
    dot: 'am',
    text: 'Mitigation pending change approval…',
    time: 'now',
  },
];

interface LinkedRecord {
  type: LinkType;
  id: string;
  sub: string;
  href: string;
  internal: boolean;
}

const LINKS: LinkedRecord[] = [
  { type: 'finding', id: 'SEC-041', sub: 'Batch job exhausts DB connection pool', href: '/v2/security', internal: true },
  { type: 'change', id: 'CHG-088', sub: 'Raise pool limit 20→40, kill stuck job', href: '#', internal: false },
  { type: 'ticket', id: 'OPS-0007', sub: 'Customer flagged slow / failing requests', href: '/v2/support/OPS-0007', internal: true },
  { type: 'kb', id: 'Runbook', sub: 'Postgres connection-pool exhaustion', href: '#', internal: false },
];

const LINK_KIND: Record<LinkType, string> = {
  finding: 'Finding',
  change: 'Change',
  ticket: 'Ticket',
  kb: 'KB article',
};

interface AffectedService {
  name: string;
  sub: string;
  state: SvcState;
  label: string;
}

const SERVICES: AffectedService[] = [
  { name: 'Transcription worker', sub: 'Queue backing up', state: 'degraded', label: 'Degraded' },
  { name: 'scribuo.com web', sub: 'Elevated latency', state: 'degraded', label: 'Slow' },
  { name: 'Postgres primary', sub: 'Root cause', state: 'down', label: 'Root cause' },
];

// ---- inline icons -----------------------------------------------------------

function LinkTypeIcon({ type }: { type: LinkType }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'finding':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'change':
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case 'ticket':
      return (
        <svg {...common}>
          <path d="M21 8V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v1a2 2 0 0 1 0 4v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1a2 2 0 0 1 0-4z" />
          <line x1="13" y1="5" x2="13" y2="19" />
        </svg>
      );
    case 'kb':
    default:
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
  }
}

function renderEventText(text: string, ref: string) {
  // Split "{ref}" out so the reference can be emphasised in the timeline copy.
  const parts = text.split('{ref}');
  if (parts.length === 1) return text;
  return (
    <>
      {parts[0]}
      <b>{ref}</b>
      {parts[1]}
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('operations');
  const { ref } = await params;

  return (
    <div className="v2-inc-page">
      {/* ---------- Header ---------- */}
      <div className="v2-inc-head">
        <div className="v2-inc-head-main">
          <div className="v2-eyebrow">Incidents · Response</div>
          <span className="v2-pill crit" style={{ marginTop: 8, marginBottom: 8 }}>
            P1 · Active
          </span>
          <h1 className="v2-h1">{ref} · Postgres primary — connection pool exhausted</h1>
          <div className="v2-inc-meta">
            <span>opened 12m ago</span>
            <span>·</span>
            <b>db-primary</b>
            <span>·</span>
            <span>
              commander: <b>Hermes</b>
            </span>
            <span>·</span>
            <span>Escalations</span>
          </div>
        </div>
        <div className="v2-inc-head-side">
          <div className="v2-inc-head-actions">
            <TicketStatusControl refId={ref} kind="incident" status="open" />
          </div>
        </div>
      </div>

      {/* ---------- Status strip ---------- */}
      <div className="v2-inc-strip">
        <div className="v2-inc-sc">
          <div className="k">Impact</div>
          <div className="v">
            Degraded
            <small>web + worker</small>
          </div>
        </div>
        <div className="v2-inc-sc">
          <div className="k">Customers</div>
          <div className="v">
            ~120
            <small>affected now</small>
          </div>
        </div>
        <div className="v2-inc-sc">
          <div className="k">Duration</div>
          <div className="v">
            12m
            <small>SLA 30m</small>
          </div>
        </div>
        <div className="v2-inc-sc">
          <div className="k">Linked change</div>
          <div className="v">
            CHG-088
            <small>proposed</small>
          </div>
        </div>
      </div>

      {/* ---------- Two-column grid ---------- */}
      <div className="v2-inc-grid">
        {/* ===== LEFT — Timeline ===== */}
        <div className="v2-inc-col">
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Timeline</h3>
              <span className="v2-link">Full log</span>
            </div>
            <div className="v2-inc-tl">
              {EVENTS.map((ev, i) => (
                <div key={i} className="v2-inc-ev">
                  <span className={`v2-inc-ev-dot ${ev.dot}`} />
                  <div className="v2-inc-ev-body">
                    <div className="v2-inc-ev-txt">{renderEventText(ev.text, ref)}</div>
                    <div className="v2-inc-ev-foot">
                      <span className="v2-inc-ev-time">{ev.time}</span>
                      {ev.tag && <span className={`v2-inc-ev-tag ${ev.tag.kind}`}>{ev.tag.label}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <TicketComposer refId={ref} />
          </div>
        </div>

        {/* ===== RIGHT ===== */}
        <div className="v2-inc-col">
          {/* Hermes · Incident assessment */}
          <HermesPanel refId={ref} agent="incident" />

          {/* Linked */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Linked</h3>
            </div>
            <div className="v2-inc-link-list">
              {LINKS.map((l) =>
                l.internal ? (
                  <Link key={l.id} href={l.href} className="v2-inc-link">
                    <span className={`v2-inc-link-ic ${l.type}`}>
                      <LinkTypeIcon type={l.type} />
                    </span>
                    <div className="v2-inc-link-main">
                      <div className="v2-inc-link-id">{l.id}</div>
                      <div className="v2-inc-link-sub">{l.sub}</div>
                    </div>
                    <span className="v2-inc-link-kind">{LINK_KIND[l.type]}</span>
                  </Link>
                ) : (
                  <a key={l.id} href={l.href} className="v2-inc-link">
                    <span className={`v2-inc-link-ic ${l.type}`}>
                      <LinkTypeIcon type={l.type} />
                    </span>
                    <div className="v2-inc-link-main">
                      <div className="v2-inc-link-id">{l.id}</div>
                      <div className="v2-inc-link-sub">{l.sub}</div>
                    </div>
                    <span className="v2-inc-link-kind">{LINK_KIND[l.type]}</span>
                  </a>
                ),
              )}
            </div>
          </div>

          {/* Affected services */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Affected services</h3>
            </div>
            <div className="v2-inc-svc-list">
              {SERVICES.map((s) => (
                <div key={s.name} className="v2-inc-svc">
                  <span className={`v2-inc-svc-dot ${s.state}`} />
                  <div className="v2-inc-svc-main">
                    <div className="v2-inc-svc-name">{s.name}</div>
                    <div className="v2-inc-svc-sub">{s.sub}</div>
                  </div>
                  <span className={`v2-inc-svc-label ${s.state}`}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Blast radius */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Blast radius</h3>
            </div>
            <div className="v2-inc-blast">
              <div className="v2-inc-blast-txt">
                <b>~120 customers</b> · 2 services · 1 open ticket. Fixing <b>CHG-088</b> clears the chain.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
