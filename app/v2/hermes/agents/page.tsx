import './agents.css';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   Static, plausible data. Nothing is fetched — this page is a design surface
   for the Hermes agent org + a live activity stream.
   ------------------------------------------------------------------------- */

type DeptStatus = 'active' | 'watching';

interface Dept {
  name: string;
  sub: string;
  icon: 'headset' | 'flame' | 'shield' | 'coin';
  status: DeptStatus;
}

interface ExecGroup {
  exec: string;
  role: string;
  depts: Dept[];
}

const org: ExecGroup[] = [
  {
    exec: 'Support exec',
    role: 'exec',
    depts: [
      { name: 'Support', sub: 'front line', icon: 'headset', status: 'active' },
      { name: 'Escalations', sub: 'complex / angry', icon: 'flame', status: 'active' },
    ],
  },
  {
    exec: 'CTO / Risk',
    role: 'exec',
    depts: [{ name: 'Security', sub: 'notify Ben', icon: 'shield', status: 'watching' }],
  },
  {
    exec: 'CFO',
    role: 'exec',
    depts: [{ name: 'Billing', sub: 'capped', icon: 'coin', status: 'active' }],
  },
];

type FeedTone = 'ok' | 'bl' | 'rd' | 'am';
type FeedIcon = 'check' | 'pencil' | 'book' | 'shield' | 'flame' | 'coin' | 'route';

interface FeedEntry {
  tone: FeedTone;
  icon: FeedIcon;
  dept: string;
  action: string; // text before an optional ref
  ref?: string;
  tail?: string; // text after the ref
  meta: string[]; // joined with a middot separator
}

const feed: FeedEntry[] = [
  {
    tone: 'ok',
    icon: 'check',
    dept: 'Support',
    action: 'auto-resolved',
    ref: 'SUP-1190',
    tail: '— KB-answerable',
    meta: ['2m ago', 'autonomous'],
  },
  {
    tone: 'bl',
    icon: 'pencil',
    dept: 'Support',
    action: 'drafted reply on',
    ref: 'SUP-1186',
    meta: ['8m ago', 'awaiting review'],
  },
  {
    tone: 'bl',
    icon: 'book',
    dept: 'Support',
    action: 'published KB “Invite teammates”',
    meta: ['20m ago', 'approved by you'],
  },
  {
    tone: 'rd',
    icon: 'shield',
    dept: 'Security',
    action: 'flagged',
    ref: 'SEC-044',
    tail: 'Ollama exposed → notified you',
    meta: ['35m ago'],
  },
  {
    tone: 'am',
    icon: 'flame',
    dept: 'Escalations',
    action: 'took over',
    ref: 'SUP-1184',
    tail: '— churn risk',
    meta: ['1h ago'],
  },
  {
    tone: 'am',
    icon: 'coin',
    dept: 'CFO',
    action: 'recommended refund on',
    ref: 'SUP-1187',
    meta: ['1h ago', 'queued for you'],
  },
  {
    tone: 'bl',
    icon: 'route',
    dept: 'Orchestrator',
    action: 'routed 3 tickets → Escalations',
    meta: ['2h ago'],
  },
];

/* ---------------------------------------------------------------------------
   Inline icons (currentColor, 16px). Kept tiny and dependency-free.
   ------------------------------------------------------------------------- */

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'crown':
      return (
        <svg {...p}>
          <path d="M3 18h18M4 8l4 4 4-6 4 6 4-4-1.5 8H5.5L4 8z" />
        </svg>
      );
    case 'headset':
      return (
        <svg {...p}>
          <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
          <rect x="2" y="13" width="4" height="6" rx="1" />
          <rect x="18" y="13" width="4" height="6" rx="1" />
          <path d="M20 19a4 4 0 0 1-4 4h-3" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...p}>
          <path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 2 2c1.5 0 2-1.5 1-4-.5-1.5 1-4 1-4z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...p}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M9.5 10.5a2.5 2 0 0 1 5 0M9.5 13.5a2.5 2 0 0 0 5 0" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...p}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...p}>
          <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
          <path d="M4 19a2 2 0 0 1 2-2h13" />
        </svg>
      );
    case 'route':
      return (
        <svg {...p}>
          <circle cx="6" cy="19" r="2.5" />
          <circle cx="18" cy="5" r="2.5" />
          <path d="M8.5 19H14a3 3 0 0 0 0-6H10a3 3 0 0 1 0-6h5.5" />
        </svg>
      );
    default:
      return null;
  }
}

function statusPill(status: DeptStatus) {
  return status === 'active'
    ? { cls: 'ok', label: 'Active' }
    : { cls: 'high', label: 'Watching' };
}

export default async function V2HermesAgentsPage() {
  await requireSectionPage('hermes');

  return (
    <div className="v2-ag-page">
      {/* Header + inline metrics */}
      <div>
        <div className="v2-eyebrow">Hermes</div>
        <h1 className="v2-h1">Agents &amp; activity</h1>
        <div className="v2-ag-metrics">
          <div className="v2-ag-stat">
            <b>42</b>
            <span>auto-resolved</span>
          </div>
          <div className="v2-ag-stat">
            <b>11</b>
            <span>drafted</span>
          </div>
          <div className="v2-ag-stat">
            <b>6</b>
            <span>awaiting you</span>
          </div>
          <div className="v2-ag-stat">
            <b>3</b>
            <span>KB written</span>
          </div>
        </div>
      </div>

      {/* 2-col: org tree + activity feed */}
      <div className="v2-ag-grid">
        {/* LEFT — org tree */}
        <section className="v2-card">
          <div className="v2-card-h">
            <h3>Org · execs own departments</h3>
          </div>
          <div className="v2-ag-tree">
            {org.map((g) => (
              <div className="v2-ag-group" key={g.exec}>
                <div className="v2-ag-exec">
                  <span className="crown">
                    <Icon name="crown" size={15} />
                  </span>
                  <span className="nm">{g.exec}</span>
                  <span className="rl">Exec</span>
                </div>
                <div className="v2-ag-depts">
                  {g.depts.map((d) => {
                    const pill = statusPill(d.status);
                    return (
                      <div className="v2-ag-dept" key={d.name}>
                        <span className="ico">
                          <Icon name={d.icon} size={13} />
                        </span>
                        <span className="body">
                          <span className="nm">{d.name}</span>
                          <span className="sub">{d.sub}</span>
                        </span>
                        <span className={`v2-pill ${pill.cls}`}>{pill.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="v2-ag-footnote">
              <b>COO · CMO · Orchestrator</b> — read &amp; recommend
            </div>
          </div>
        </section>

        {/* RIGHT — activity feed */}
        <section className="v2-card">
          <div className="v2-card-h">
            <h3>Activity</h3>
            <span className="v2-ag-live">
              <span className="dot" />
              live
            </span>
          </div>
          <div className="v2-ag-feed">
            {feed.map((e, i) => (
              <div className="v2-ag-row" key={i}>
                <span className={`v2-ag-ico ${e.tone}`}>
                  <Icon name={e.icon} size={15} />
                </span>
                <div>
                  <div className="t">
                    <b>{e.dept}</b> {e.action}
                    {e.ref ? <> <span className="v2-ag-ref">{e.ref}</span></> : null}
                    {e.tail ? <> {e.tail}</> : null}
                  </div>
                  <div className="meta">
                    {e.meta.map((m, mi) => (
                      <span key={mi}>
                        {mi > 0 ? <span className="sep">·&nbsp;</span> : null}
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
