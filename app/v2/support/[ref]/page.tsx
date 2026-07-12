import Link from 'next/link';
import { tickets, type Severity, type Ticket } from '@/lib/mock';
import { requireSectionPage, getSessionAccess } from '@/lib/auth';
import { TicketComposer, TicketStatusControl } from '@/components/v2/ticket-actions';
import { AssignControl, EscalateControl } from '@/components/v2/support-assign';
import { getSupportStaff } from '@/lib/support/data';
import { authorize } from '@/lib/support/roles';
import HermesPanel from '@/components/v2/HermesPanel';
import './ticket.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// The mock `tickets` carry ref/title/type/status/priority/assignee/source/age.
// The detail view needs richer, human-plausible context (customer, plan, SLA,
// conversation, impacted infrastructure, linked records) that the mock lacks —
// so we decorate each ref with static, sensible values keyed below. No lorem.
// ---------------------------------------------------------------------------

type SlaState = 'ok' | 'warn' | 'breach';
type ResState = 'ok' | 'degraded' | 'down';

interface Deco {
  subject: string; // short human subject line for the header
  customer: string;
  plan: string;
  mrr: string;
  owner: string; // display name; '' → unassigned
  opened: string; // "opened 2 days ago"
  description: string;
  sla: { state: SlaState; text: string };
  blast: { customers: number; services: number; incidents: number; note: string };
  conversation: {
    customerName: string;
    customerTime: string;
    customerBody: string;
    staffName: string;
    staffTime: string;
    staffBody: string;
  };
  hermes: {
    recommends: string;
    reasoning: string;
    sources: string[];
    confidence: number;
    thread: { who: 'agent' | 'you'; body: string }[];
  };
  infra: { role: string; name: string; state: ResState; label: string }[];
  links: { type: 'incident' | 'change' | 'finding' | 'kb'; id: string; label: string; href: string }[];
  sharesWith: number;
}

function priorityPill(p: Severity): { cls: string; label: string } {
  switch (p) {
    case 'critical':
      return { cls: 'crit', label: 'Critical' };
    case 'high':
      return { cls: 'high', label: 'High' };
    case 'medium':
      return { cls: 'info', label: 'Medium' };
    case 'low':
      return { cls: 'info', label: 'Low' };
    default:
      return { cls: 'info', label: p.charAt(0).toUpperCase() + p.slice(1) };
  }
}

// Status → pill class + label for the header status chip.
function statusPill(s: string): { cls: string; label: string } {
  switch (s) {
    case 'resolved':
    case 'fulfilled':
    case 'closed':
      return { cls: 'ok', label: s.charAt(0).toUpperCase() + s.slice(1) };
    case 'in_progress':
      return { cls: 'info', label: 'In progress' };
    case 'blocked':
      return { cls: 'crit', label: 'Blocked' };
    default:
      return { cls: 'info', label: s.charAt(0).toUpperCase() + s.slice(1) };
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Customer string → URL slug (lowercase, non-alphanumerics → '-'), e.g.
// "northwind.io" → "northwind-io", "Acme Co" → "acme-co". Kept in sync with
// the same helper in components/v2/SupportTable.tsx so links resolve identically.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const OWNER_NAME: Record<string, string> = { ben: 'Ben Percival', '—': '' };

const DECO: Record<string, Deco> = {
  'OPS-0007': {
    subject: 'Docker socket exposed — customer flagged risky access',
    customer: 'Acme Co',
    plan: 'Business',
    mrr: '£69/mo',
    owner: 'Ben Percival',
    opened: 'opened 2 days ago',
    description:
      'Customer security review noticed the app container can reach the Docker daemon directly. They want confirmation it is being locked down before their own audit sign-off.',
    sla: { state: 'breach', text: 'Breached 22m' },
    blast: {
      customers: 120,
      services: 2,
      incidents: 1,
      note: 'Affects ~120 customers · 2 services · 1 open incident — fixing CHG-088 clears the chain.',
    },
    conversation: {
      customerName: 'Dana Reyes',
      customerTime: '2 days ago',
      customerBody:
        'Our pen-test flagged that the app container has read/write on the Docker socket. Can you confirm what mitigation is in flight? We need this closed before Friday for our SOC 2 evidence pack.',
      staffName: 'Ben Percival',
      staffTime: '1 day ago',
      staffBody:
        'Thanks Dana — a read-only socket proxy is being rolled out under change CHG-088. I will share the config diff and the follow-up finding SEC-041 once it lands.',
    },
    hermes: {
      recommends: 'Draft reply + link CHG-088',
      reasoning:
        'Account history shows this org is in an active SOC 2 window; the mitigation change is already scheduled, so a status reply referencing CHG-088 resolves the customer ask without any entitlement or money change.',
      sources: ['Account history', 'KB · Docker socket proxy', 'CFO note'],
      confidence: 86,
      thread: [
        { who: 'agent', body: 'I can send Dana the CHG-088 window and attach the socket-proxy KB. Approve the draft?' },
        { who: 'you', body: 'Does the change window land before their Friday deadline?' },
      ],
    },
    infra: [
      { role: 'Service', name: 'scribuo.com web', state: 'degraded', label: 'Degraded' },
      { role: 'Component', name: 'billing-api', state: 'ok', label: 'Healthy' },
      { role: 'Host', name: 'ovh-ns3159912', state: 'ok', label: 'Up' },
    ],
    links: [
      { type: 'incident', id: 'INC-204', label: 'Socket exposure incident', href: '#' },
      { type: 'change', id: 'CHG-088', label: 'Harden Docker socket via read-only proxy', href: '/v2/hermes/approvals' },
      { type: 'finding', id: 'SEC-041', label: 'Raw Docker socket exposed to app container', href: '/v2/security' },
      { type: 'kb', id: 'docker-socket-proxy', label: 'Hardening the Docker socket', href: '#' },
    ],
    sharesWith: 3,
  },
  'OPS-0006': {
    subject: 'Public submit endpoint hammered — customer over quota',
    customer: 'Northwind Labs',
    plan: 'Pro',
    mrr: '£18/mo',
    owner: '',
    opened: 'opened 1 day ago',
    description:
      'Customer reports repeated 429s and suspects abuse traffic is eating their quota on the public submit endpoint. They want rate limiting in place and their counter reset.',
    sla: { state: 'warn', text: '38m left' },
    blast: {
      customers: 60,
      services: 1,
      incidents: 1,
      note: 'Affects ~60 customers · 1 service · 1 open incident — fixing CHG-088 clears the chain.',
    },
    conversation: {
      customerName: 'Marcus Vale',
      customerTime: '1 day ago',
      customerBody:
        'We keep hitting quota limits mid-morning even though our own usage is light. Is something abusing the submit endpoint? Please add rate limiting and reset our counter.',
      staffName: 'Ben Percival',
      staffTime: '20 hours ago',
      staffBody:
        'Confirmed — an abuse cluster is inflating the shared counter. Rate limiting is queued under CHG-088; I will reset your quota once it deploys.',
    },
    hermes: {
      recommends: 'Reset quota + draft reply',
      reasoning:
        'Usage telemetry confirms the overage is abuse-driven, not customer traffic, so a quota reset is within guideline and needs no money movement — only a status reply and the reset action.',
      sources: ['Account history', 'KB · Rate limiting', 'CFO note'],
      confidence: 82,
      thread: [
        { who: 'agent', body: 'I can reset Northwind’s counter and reply with the rate-limit ETA. Approve?' },
        { who: 'you', body: 'Reset is fine — hold the reply until CHG-088 has a firm window.' },
      ],
    },
    infra: [
      { role: 'Service', name: 'scribuo.com web', state: 'ok', label: 'Up' },
      { role: 'Component', name: 'videos-api', state: 'degraded', label: 'Rate-limited' },
      { role: 'Host', name: 'ovh-ns3159912', state: 'ok', label: 'Up' },
    ],
    links: [
      { type: 'incident', id: 'INC-204', label: 'Submit-endpoint abuse incident', href: '#' },
      { type: 'change', id: 'CHG-088', label: 'Add rate limiting to public submit endpoints', href: '/v2/hermes/approvals' },
      { type: 'finding', id: 'SEC-041', label: 'No rate limit on /api/videos submit', href: '/v2/security' },
      { type: 'kb', id: 'rate-limiting', label: 'Adding rate limits to public endpoints', href: '#' },
    ],
    sharesWith: 5,
  },
};

// Fallback decoration for any ticket ref without a bespoke entry above.
function fallbackDeco(t: Ticket): Deco {
  const owner = OWNER_NAME[t.assignee] ?? (t.assignee === '—' ? '' : t.assignee);
  return {
    subject: t.title,
    customer: 'Globex Media',
    plan: 'Studio',
    mrr: '£29/mo',
    owner,
    opened: `opened ${t.age} ago`,
    description:
      'Customer raised this through the support desk. Sentinel has correlated it with the estate’s open change so the fix and its blast radius are visible in one place.',
    sla: { state: 'ok', text: '4h left' },
    blast: {
      customers: 120,
      services: 2,
      incidents: 1,
      note: 'Affects ~120 customers · 2 services · 1 open incident — fixing CHG-088 clears the chain.',
    },
    conversation: {
      customerName: 'Priya Nair',
      customerTime: `${t.age} ago`,
      customerBody:
        'Flagging this from our side — can you confirm what is being done and when we can expect it resolved? Happy to provide more detail if useful.',
      staffName: owner || 'Ben Percival',
      staffTime: 'a few hours ago',
      staffBody:
        'Thanks for the detail — this is linked to change CHG-088 which addresses the root cause. I will update you as soon as it lands.',
    },
    hermes: {
      recommends: 'Draft reply',
      reasoning:
        'Account history and the linked change give a clear status to report, so a drafted reply resolves the customer ask with no entitlement or money change required.',
      sources: ['Account history', 'KB', 'CFO note'],
      confidence: 84,
      thread: [
        { who: 'agent', body: 'I can draft a status reply referencing CHG-088. Approve to send?' },
        { who: 'you', body: 'Let me read the change window first before it goes out.' },
      ],
    },
    infra: [
      { role: 'Service', name: 'scribuo.com web', state: 'degraded', label: 'Degraded' },
      { role: 'Component', name: 'billing-api', state: 'ok', label: 'Healthy' },
      { role: 'Host', name: 'ovh-ns3159912', state: 'ok', label: 'Up' },
    ],
    links: [
      { type: 'incident', id: 'INC-204', label: 'Correlated incident', href: '#' },
      { type: 'change', id: 'CHG-088', label: 'Root-cause change', href: '/v2/hermes/approvals' },
      { type: 'finding', id: 'SEC-041', label: 'Correlated finding', href: '/v2/security' },
      { type: 'kb', id: 'kb', label: 'Related runbook', href: '#' },
    ],
    sharesWith: 4,
  };
}

// ---- inline icons -----------------------------------------------------------

function WarnIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function LinkTypeIcon({ type }: { type: 'incident' | 'change' | 'finding' | 'kb' }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'incident':
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
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
    case 'finding':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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

const LINK_KIND: Record<'incident' | 'change' | 'finding' | 'kb', string> = {
  incident: 'Incident',
  change: 'Change',
  finding: 'Finding',
  kb: 'KB article',
};

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('support');
  const { ref } = await params;

  const ticket = tickets.find((t) => t.ref.toLowerCase() === ref.toLowerCase());

  if (!ticket) {
    return (
      <div>
        <div className="v2-eyebrow">Support · Ticket</div>
        <h1 className="v2-h1">Ticket not found</h1>
        <div className="v2-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="v2-sub" style={{ marginTop: 0 }}>
            Ticket <b>{ref}</b> not found. It may have been closed or the reference is mistyped.
          </div>
          <div style={{ marginTop: 14 }}>
            <Link href="/v2/support" className="v2-link">
              ← Back to the customer desk
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const d = DECO[ticket.ref] ?? fallbackDeco(ticket);
  const pill = priorityPill(ticket.priority);
  const status = statusPill(ticket.status);

  // P3 — resolve the caller's support-action authority + the staff roster so the
  // assign dropdown + escalate button render only for permitted roles.
  const { role } = await getSessionAccess();
  const canAssign = authorize(role, 'assign') === 'allow';
  const canEscalate = authorize(role, 'escalate') === 'allow';
  const staff = canAssign ? await getSupportStaff() : [];

  // Surface the Hermes · Billing (CFO) agent only when the ticket is clearly
  // money-related. We match against the ticket title/type and the decorated
  // description (the richer, human context) since the mock ticket itself has
  // no description field.
  const isBilling = /refund|billing|payment|charge|invoice|subscription|plan|pric|dunning/i.test(
    `${ticket.title} ${ticket.type ?? ''} ${d.description}`,
  );

  return (
    <div className="v2-td-page">
      {/* ---------- Header ---------- */}
      <div className="v2-td-head">
        <div className="v2-td-head-main">
          <div className="v2-eyebrow">Support · Ticket</div>
          <h1 className="v2-h1">
            {ticket.ref} · {d.subject}
          </h1>
          <div className="v2-sub">
            {d.customer} · {d.plan} plan · {d.opened} · owner {d.owner || 'Unassigned'}
          </div>
        </div>
        <div className="v2-td-head-side">
          <div className="v2-td-pills">
            <span className={`v2-pill ${pill.cls}`}>{pill.label}</span>
            <span className={`v2-pill ${status.cls}`}>{status.label}</span>
            <span className={`v2-td-sla ${d.sla.state}`}>{d.sla.text}</span>
          </div>
          <div className="v2-td-head-actions">
            <TicketStatusControl refId={ticket.ref} kind="request" status={ticket.status || 'open'} />
            {canAssign && (
              <AssignControl
                refId={ticket.ref}
                staff={staff.map((s) => ({ clerkUserId: s.clerkUserId, displayName: s.displayName, tier: s.tier }))}
                current={ticket.assignee && ticket.assignee !== '—' ? ticket.assignee : ''}
              />
            )}
            {canEscalate && <EscalateControl refId={ticket.ref} />}
          </div>
        </div>
      </div>

      {/* ---------- Blast-radius strip ---------- */}
      <div className="v2-td-blast">
        <span className="v2-td-blast-ic">
          <WarnIcon />
        </span>
        <span className="v2-td-blast-txt">{d.blast.note}</span>
      </div>

      {/* ---------- Two-column grid ---------- */}
      <div className="v2-td-grid">
        {/* ===== LEFT ===== */}
        <div className="v2-td-col">
          {/* Conversation */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Conversation</h3>
              <span className="v2-link">View full thread</span>
            </div>
            <div className="v2-td-conv">
              <div className="v2-td-msg">
                <span className="v2-td-msg-av">{initials(d.conversation.customerName)}</span>
                <div className="v2-td-msg-body">
                  <div className="v2-td-msg-head">
                    <b>{d.conversation.customerName}</b>
                    <span className="v2-td-msg-tag">Customer</span>
                    <span className="v2-td-msg-time">{d.conversation.customerTime}</span>
                  </div>
                  <div className="v2-td-msg-text">{d.conversation.customerBody}</div>
                </div>
              </div>

              <div className="v2-td-msg staff">
                <span className="v2-td-msg-av staff">{initials(d.conversation.staffName)}</span>
                <div className="v2-td-msg-body">
                  <div className="v2-td-msg-head">
                    <b>{d.conversation.staffName}</b>
                    <span className="v2-td-msg-tag staff">Agent</span>
                    <span className="v2-td-msg-time">{d.conversation.staffTime}</span>
                  </div>
                  <div className="v2-td-msg-text">{d.conversation.staffBody}</div>
                </div>
              </div>
            </div>
            <TicketComposer refId={ticket.ref} />
          </div>

          {/* Hermes · Support — live copilot draft panel */}
          <HermesPanel refId={ticket.ref} />

          {/* Hermes · Escalations — draft an escalation summary when the front
              line can't resolve this ticket. Same copilot panel, escalation agent. */}
          <HermesPanel refId={ticket.ref} agent="escalation" />

          {/* Hermes · Billing (CFO) — only surfaced for money-related tickets
              (refunds, billing, payments, invoices, subscriptions, dunning). */}
          {isBilling && <HermesPanel refId={ticket.ref} agent="billing" />}
        </div>

        {/* ===== RIGHT — Impacted resources ===== */}
        <div className="v2-td-col">
          {/* Infrastructure */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Impacted infrastructure</h3>
            </div>
            <div className="v2-td-res-list">
              {d.infra.map((r) => (
                <div key={r.role} className="v2-td-res">
                  <span className={`v2-td-dot ${r.state}`} />
                  <div className="v2-td-res-main">
                    <div className="v2-td-res-name">{r.name}</div>
                    <div className="v2-td-res-role">{r.role}</div>
                  </div>
                  <span className={`v2-td-res-label ${r.state}`}>{r.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Linked records */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Linked records</h3>
            </div>
            <div className="v2-td-link-list">
              {d.links.map((l) => (
                <Link key={l.id} href={l.href} className="v2-td-linkrow">
                  <span className={`v2-td-link-ic ${l.type}`}>
                    <LinkTypeIcon type={l.type} />
                  </span>
                  <div className="v2-td-link-main">
                    <div className="v2-td-link-id">{l.id}</div>
                    <div className="v2-td-link-lab">{l.label}</div>
                  </div>
                  <span className="v2-td-link-kind">{LINK_KIND[l.type]}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Customer / org */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Customer / org</h3>
            </div>
            <div className="v2-td-cust">
              <div className="v2-td-cust-top">
                <span className="v2-td-cust-av">{initials(d.customer)}</span>
                <div>
                  <Link
                    href={`/v2/support/customers/${slugify(d.customer)}`}
                    className="v2-td-cust-name"
                    style={{ textDecoration: 'none' }}
                  >
                    {d.customer}
                  </Link>
                  <div className="v2-td-cust-sub">
                    {d.plan} plan · {d.mrr}
                  </div>
                </div>
              </div>
              <div className="v2-td-cust-note">
                Shares this impact with <b>{d.sharesWith}</b> other customers.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
