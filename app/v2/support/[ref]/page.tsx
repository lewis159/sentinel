import Link from 'next/link';
import type { Severity } from '@/lib/mock';
import { requireSectionPage, getSessionAccess } from '@/lib/auth';
import { getServiceTicket, getTicketComments, getTicketEdges } from '@/lib/data';
import { TicketComposer, TicketStatusControl } from '@/components/v2/ticket-actions';
import { AssignControl, EscalateControl } from '@/components/v2/support-assign';
import { getSupportStaff } from '@/lib/support/data';
import { authorize } from '@/lib/support/roles';
import { computeSla, slaBadgeClass, slaBadgeLabel } from '@/lib/support/sla';
import HermesPanel from '@/components/v2/HermesPanel';
import './ticket.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Support ticket detail — REAL data. The ticket core comes from getServiceTicket
// (ops.tickets), the conversation from getTicketComments (ops.comments) and the
// linked/impacted records from getTicketEdges (ops.links). The previous version
// decorated each ref with a static `Deco` block (fabricated customer, plan, MRR,
// conversation, blast radius, infra list, linked records) — all removed. Where a
// real source doesn't exist yet (blast radius, per-plan MRR), the section is
// dropped or shows an honest empty state rather than inventing values. The live
// controls (status / assign / escalate / composer / HermesPanel) are unchanged.
// ---------------------------------------------------------------------------

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
      return { cls: 'info', label: String(p).charAt(0).toUpperCase() + String(p).slice(1) };
  }
}

// Status → pill class + label for the header status chip.
function statusPill(s: string): { cls: string; label: string } {
  const label = s.replace(/_/g, ' ');
  switch (s) {
    case 'resolved':
    case 'fulfilled':
    case 'closed':
      return { cls: 'ok', label: label.charAt(0).toUpperCase() + label.slice(1) };
    case 'in_progress':
      return { cls: 'info', label: 'In progress' };
    case 'blocked':
      return { cls: 'crit', label: 'Blocked' };
    default:
      return { cls: 'info', label: label.charAt(0).toUpperCase() + label.slice(1) };
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s.@]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Customer string → URL slug (lowercase, non-alphanumerics → '-'), kept in sync
// with the same helper in components/v2/SupportTable.tsx.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Map an ops.links edge type onto a link-row icon/label bucket.
type LinkBucket = 'incident' | 'change' | 'finding' | 'kb';
function bucketFor(type: string): LinkBucket {
  const t = type.toLowerCase();
  if (t.includes('incident') || t.includes('ticket')) return 'incident';
  if (t.includes('change')) return 'change';
  if (t.includes('finding') || t.includes('security')) return 'finding';
  return 'kb';
}

function LinkTypeIcon({ type }: { type: LinkBucket }) {
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

const LINK_KIND: Record<LinkBucket, string> = {
  incident: 'Incident',
  change: 'Change',
  finding: 'Finding',
  kb: 'KB article',
};

// Per-comment visibility badge — makes the internal/external gate visible on the
// timeline so an operator can see at a glance which notes a customer would see.
function VisBadge({ visibility }: { visibility: 'internal' | 'external' }) {
  return visibility === 'external' ? (
    <span className="v2-td-vis external" title="Visible to the customer">
      External · customer sees
    </span>
  ) : (
    <span className="v2-td-vis internal" title="Team-only — hidden from the customer">
      Internal · team only
    </span>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('support');
  const { ref } = await params;

  const [{ row: ticket }, comments, edges] = await Promise.all([
    getServiceTicket(ref),
    getTicketComments(ref),
    getTicketEdges(ref),
  ]);

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

  const pill = priorityPill(ticket.priority);
  const status = statusPill(ticket.status);
  const sla = computeSla({ priority: ticket.priority, status: ticket.status, age: ticket.age });

  const customer = ticket.customerName || ticket.tenantRef || ticket.customerEmail || 'Internal';
  const isInternal = !ticket.customerName && !ticket.tenantRef && !ticket.customerEmail;
  const owner = ticket.assignee && ticket.assignee !== '—' ? ticket.assignee : '';

  // P3 — resolve the caller's support-action authority + the staff roster so the
  // assign dropdown + escalate button render only for permitted roles.
  const { role } = await getSessionAccess();
  const canAssign = authorize(role, 'assign') === 'allow';
  const canEscalate = authorize(role, 'escalate') === 'allow';
  const staff = canAssign ? await getSupportStaff() : [];

  // Surface the Hermes · Billing (CFO) agent only when the ticket is clearly
  // money-related — matched against the ticket's real title + description.
  const isBilling = /refund|billing|payment|charge|invoice|subscription|plan|pric|dunning/i.test(
    `${ticket.title} ${ticket.description ?? ''}`,
  );

  return (
    <div className="v2-td-page">
      {/* ---------- Header ---------- */}
      <div className="v2-td-head">
        <div className="v2-td-head-main">
          <div className="v2-eyebrow">Support · Ticket</div>
          <h1 className="v2-h1">
            {ticket.ref} · {ticket.title}
          </h1>
          <div className="v2-sub">
            {customer} · {ticket.app} · opened {ticket.age} ago · owner {owner || 'Unassigned'}
          </div>
        </div>
        <div className="v2-td-head-side">
          <div className="v2-td-pills">
            <span className={`v2-pill ${pill.cls}`}>{pill.label}</span>
            <span className={`v2-pill ${status.cls}`}>{status.label}</span>
            <span className={`v2-td-sla ${slaBadgeClass(sla.state)}`} title={sla.dueAt ? `SLA due ${new Date(sla.dueAt).toLocaleString()}` : 'No SLA target'}>{slaBadgeLabel(sla)}</span>
          </div>
          <div className="v2-td-head-actions">
            <TicketStatusControl refId={ticket.ref} kind={ticket.kind} status={ticket.status || 'open'} />
            {canAssign && (
              <AssignControl
                refId={ticket.ref}
                staff={staff.map((s) => ({ clerkUserId: s.clerkUserId, displayName: s.displayName, tier: s.tier }))}
                current={owner}
              />
            )}
            {canEscalate && <EscalateControl refId={ticket.ref} />}
          </div>
        </div>
      </div>

      {/* ---------- Two-column grid ---------- */}
      <div className="v2-td-grid">
        {/* ===== LEFT ===== */}
        <div className="v2-td-col">
          {/* Description */}
          {ticket.description && (
            <div className="v2-card">
              <div className="v2-card-h">
                <h3>Description</h3>
              </div>
              <div className="v2-td-msg-text" style={{ padding: '4px 4px 8px' }}>{ticket.description}</div>
            </div>
          )}

          {/* Conversation */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Conversation</h3>
              <span className="v2-link">{comments.length} update{comments.length === 1 ? '' : 's'}</span>
            </div>
            {comments.length === 0 ? (
              <div style={{ padding: '20px 8px', color: 'var(--muted)', fontSize: 13 }}>
                No messages yet. Updates posted below appear here on the ticket timeline.
              </div>
            ) : (
              <div className="v2-td-conv">
                {comments.map((c) => (
                  <div key={c.id} className={`v2-td-msg${c.visibility === 'internal' ? ' staff' : ''}`}>
                    <span className={`v2-td-msg-av${c.visibility === 'internal' ? ' staff' : ''}`}>{initials(c.author)}</span>
                    <div className="v2-td-msg-body">
                      <div className="v2-td-msg-head">
                        <b>{c.author}</b>
                        <VisBadge visibility={c.visibility} />
                        <span className="v2-td-msg-time">{relTime(c.createdAt)}</span>
                      </div>
                      <div className="v2-td-msg-text">{c.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <TicketComposer refId={ticket.ref} />
          </div>

          {/* Hermes · Support — live copilot draft panel */}
          <HermesPanel refId={ticket.ref} />

          {/* Hermes · Escalations — draft an escalation summary when the front
              line can't resolve this ticket. Same copilot panel, escalation agent. */}
          <HermesPanel refId={ticket.ref} agent="escalation" />

          {/* Hermes · Billing (CFO) — only surfaced for money-related tickets. */}
          {isBilling && <HermesPanel refId={ticket.ref} agent="billing" />}
        </div>

        {/* ===== RIGHT — Impacted resources ===== */}
        <div className="v2-td-col">
          {/* Linked records (ops.links) */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Linked records</h3>
            </div>
            {edges.length === 0 ? (
              <div style={{ padding: '18px 8px', color: 'var(--muted)', fontSize: 13 }}>
                No linked records. Related incidents, changes, findings or articles appear
                here once linked.
              </div>
            ) : (
              <div className="v2-td-link-list">
                {edges.map((l) => {
                  const bucket = bucketFor(l.type);
                  return (
                    <Link key={`${l.type}-${l.id}`} href={l.href || '#'} className="v2-td-linkrow">
                      <span className={`v2-td-link-ic ${bucket}`}>
                        <LinkTypeIcon type={bucket} />
                      </span>
                      <div className="v2-td-link-main">
                        <div className="v2-td-link-id">{l.id}</div>
                        <div className="v2-td-link-lab">{l.label}</div>
                      </div>
                      <span className="v2-td-link-kind">{LINK_KIND[bucket]}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Customer / org */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Customer / org</h3>
            </div>
            <div className="v2-td-cust">
              {isInternal ? (
                <div className="v2-td-cust-note">Internal / estate ticket — no external customer.</div>
              ) : (
                <div className="v2-td-cust-top">
                  <span className="v2-td-cust-av">{initials(customer)}</span>
                  <div>
                    <Link
                      href={`/v2/support/customers/${slugify(String(ticket.tenantRef || customer))}`}
                      className="v2-td-cust-name"
                      style={{ textDecoration: 'none' }}
                    >
                      {customer}
                    </Link>
                    {ticket.customerEmail && (
                      <div className="v2-td-cust-sub">{ticket.customerEmail}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
