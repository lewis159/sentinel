import type { CSSProperties } from 'react';
import { requireSectionPage } from '@/lib/auth';
import './floor.css';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   Static data. No Hermes backend exists yet, so the floor is dressed with a
   plausible, well-structured snapshot of what the agents are doing right now.
   --------------------------------------------------------------------------- */

type AgentId =
  | 'support'
  | 'escalations'
  | 'security'
  | 'cfo'
  | 'risk'
  | 'cto'
  | 'orchestrator';

type Presence = 'active' | 'busy' | 'idle';

interface Agent {
  id: AgentId;
  name: string;
  initials: string;
  /** Ring / accent colour — a design token where one exists, else a raw value. */
  color: string;
  presence: Presence;
}

const AGENTS: Record<AgentId, Agent> = {
  support: { id: 'support', name: 'Support', initials: 'SU', color: 'var(--accent)', presence: 'active' },
  escalations: { id: 'escalations', name: 'Escalations', initials: 'ES', color: 'var(--high)', presence: 'busy' },
  security: { id: 'security', name: 'Security', initials: 'SE', color: 'var(--crit)', presence: 'busy' },
  cfo: { id: 'cfo', name: 'CFO', initials: 'CF', color: 'var(--ok)', presence: 'active' },
  risk: { id: 'risk', name: 'Risk', initials: 'RK', color: 'var(--purple)', presence: 'active' },
  cto: { id: 'cto', name: 'CTO', initials: 'CT', color: 'var(--sky)', presence: 'busy' },
  orchestrator: { id: 'orchestrator', name: 'Orchestrator', initials: 'OR', color: 'var(--muted)', presence: 'idle' },
};

const PRESENCE_ORDER: AgentId[] = [
  'support',
  'escalations',
  'security',
  'cfo',
  'risk',
  'cto',
  'orchestrator',
];

interface ThreadMessage {
  agent: AgentId;
  /** Optional destination shown after the agent name, e.g. Support → CFO. */
  to?: AgentId;
  text: string;
  system?: boolean;
}

const THREAD: ThreadMessage[] = [
  {
    agent: 'support',
    to: 'cfo',
    text: 'Customer double-charged on SUP-1187. Recommend refund £29 — confirm?',
  },
  {
    agent: 'cfo',
    text: 'Confirmed duplicate in Stripe. £29 within auto-cap — but 2nd refund this month for acme.co. Risk?',
  },
  {
    agent: 'risk',
    text: "Both legit duplicates, account healthy, 14-mo tenure. Watch, don't block.",
  },
  {
    agent: 'cfo',
    text: 'Agreed. Approved on finance side. Money guardrail → needs Ben.',
  },
  {
    agent: 'orchestrator',
    text: 'Queued for human approval → Ben. SUP-1187',
    system: true,
  },
];

interface Collab {
  id: string;
  title: string;
  ref: string;
  icon: 'incident' | 'escalation' | 'quota';
  /** Colour of the leading party / card icon. */
  color: string;
  status: { label: string; pill: 'crit' | 'high' | 'ok' | 'info' };
  parties: AgentId[];
  latestBy: string;
  latest: string;
}

const COLLABS: Collab[] = [
  {
    id: 'inc-204',
    title: 'Incident',
    ref: 'INC-204',
    icon: 'incident',
    color: 'var(--crit)',
    status: { label: 'diagnosing', pill: 'crit' },
    parties: ['support', 'security', 'cto'],
    latestBy: 'CTO',
    latest:
      'pool exhaustion traces to the batch job — proposing a connection-limit bump.',
  },
  {
    id: 'sup-1184',
    title: 'Escalation',
    ref: 'SUP-1184',
    icon: 'escalation',
    color: 'var(--high)',
    status: { label: 'drafting', pill: 'high' },
    parties: ['support', 'escalations'],
    latestBy: 'Escalations',
    latest: 'drafting apology + 1-mo credit — CFO to approve credit.',
  },
  {
    id: 'sup-1179',
    title: 'Quota',
    ref: 'SUP-1179',
    icon: 'quota',
    color: 'var(--ok)',
    status: { label: 'awaiting Ben', pill: 'info' },
    parties: ['support', 'cfo'],
    latestBy: 'CFO',
    latest: 'upsell likely — recommend approve the bump.',
  },
];

/** Inline CSS custom property carrier (typed for strict mode). */
function ring(color: string): CSSProperties {
  return { ['--ring' as string]: color } as CSSProperties;
}

/* ---------------------------------------------------------------------------
   Small presentational helpers
   --------------------------------------------------------------------------- */

function Avatar({ agent }: { agent: Agent }) {
  return (
    <div className="v2-floor-avatar" style={ring(agent.color)}>
      {agent.initials}
      <span className={`status ${agent.presence}`} aria-hidden />
    </div>
  );
}

function CollabIcon({ kind }: { kind: Collab['icon'] }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'incident') {
    return (
      <svg {...common} aria-hidden>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (kind === 'escalation') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   Page
   --------------------------------------------------------------------------- */

export default async function HermesFloorPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      {/* Header */}
      <div className="v2-floor-head">
        <div>
          <div className="v2-eyebrow">Hermes</div>
          <div className="v2-floor-title">
            <h1 className="v2-h1">The Hermes floor</h1>
            <span className="v2-floor-live">
              <span className="dot" aria-hidden />
              Live
            </span>
          </div>
          <div className="v2-sub">
            7 agents · 3 live collaborations · watch them work, jump in anytime
          </div>
        </div>
      </div>

      {/* Presence row */}
      <div className="v2-floor-presence" aria-label="Agent presence">
        {PRESENCE_ORDER.map((id) => {
          const agent = AGENTS[id];
          return (
            <div className="v2-floor-person" key={id}>
              <Avatar agent={agent} />
              <span className="nm">{agent.name}</span>
            </div>
          );
        })}
      </div>

      {/* Main grid */}
      <div className="v2-floor-grid">
        {/* LEFT — expanded live thread */}
        <div className="v2-card">
          <div className="v2-card-h">
            <div className="v2-floor-thread-h">
              <span className="v2-floor-tag">
                <span className="ic" aria-hidden>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                  </svg>
                </span>
                Refund · £29 · acme.co
              </span>
            </div>
            <span className="v2-pill high">awaiting Ben</span>
          </div>

          <div className="v2-floor-body">
            {THREAD.map((msg, i) => {
              const agent = AGENTS[msg.agent];
              const to = msg.to ? AGENTS[msg.to] : null;
              return (
                <div
                  className={`v2-floor-msg${msg.system ? ' system' : ''}`}
                  key={`${msg.agent}-${i}`}
                >
                  <div className="v2-floor-bubble-av" style={ring(agent.color)}>
                    {agent.initials}
                  </div>
                  <div className="v2-floor-bubble">
                    <div className="who" style={ring(agent.color)}>
                      {agent.name}
                      {to ? ` → ${to.name}` : ''}
                    </div>
                    <div className="txt">{msg.text}</div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            <div className="v2-floor-typing">
              Support is drafting the customer reply…
              <span className="v2-floor-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>

          {/* Composer */}
          <div className="v2-floor-composer">
            <input
              className="v2-floor-input"
              type="text"
              placeholder="Chime in — direct the agents, or approve…"
              aria-label="Message the agents"
            />
            <button type="button" className="v2-floor-approve">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Approve refund
            </button>
          </div>
        </div>

        {/* RIGHT — collaboration cards */}
        <div className="v2-stack">
          {COLLABS.map((c) => (
            <div className="v2-card v2-floor-collab" key={c.id}>
              <div className="v2-floor-collab-top">
                <div className="v2-floor-collab-title">
                  <span className="v2-floor-collab-ic" style={ring(c.color)}>
                    <CollabIcon kind={c.icon} />
                  </span>
                  <span className="nm">
                    {c.title} {c.ref}
                    <small>{c.parties.map((p) => AGENTS[p].name).join(' · ')}</small>
                  </span>
                </div>
                <span className={`v2-pill ${c.status.pill}`}>{c.status.label}</span>
              </div>

              <div className="v2-floor-parties" aria-hidden>
                {c.parties.map((p) => (
                  <span
                    className="mini"
                    key={p}
                    style={ring(AGENTS[p].color)}
                    title={AGENTS[p].name}
                  >
                    {AGENTS[p].initials}
                  </span>
                ))}
              </div>

              <div className="v2-floor-collab-msg">
                <b>{c.latestBy}:</b> {c.latest}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
