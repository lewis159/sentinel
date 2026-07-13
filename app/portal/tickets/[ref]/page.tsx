import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePortalSession } from '@/lib/portal/auth';
import { getPortalTicket } from '@/lib/portal/tickets';
import { getTicketComments } from '@/lib/data';
import { ReplyBox } from '@/components/portal/ReplyBox';

export const dynamic = 'force-dynamic';

function humanize(v: string): string {
  return (v ?? '').toString().replace(/_/g, ' ');
}

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusClass(status: string): string {
  const s = (status ?? '').toLowerCase();
  if (['resolved', 'closed', 'fulfilled', 'implemented', 'done', 'completed'].includes(s)) return 'resolved';
  if (['in_progress', 'investigating', 'awaiting_cab', 'building', 'staged'].includes(s)) return 'in_progress';
  return 'open';
}

// A comment is "ours" (the customer's own) when kind==='customer'. Everything
// else in the EXTERNAL-only feed is a reply from the support team.
function isCustomer(kind: string): boolean {
  return (kind ?? '').toLowerCase() === 'customer';
}

export default async function PortalTicketDetail({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const session = await requirePortalSession();
  const { ref } = await params;

  // IDOR gate: getPortalTicket only returns the row when tenant_ref === the
  // session tenant. A cross-tenant ref (or unknown ref) yields null → 404, the
  // SAME response for both, so existence is never leaked.
  const ticket = await getPortalTicket(ref, session.tenantRef);
  if (!ticket) return notFound();

  // EXTERNAL comments ONLY — internal operator notes never reach the portal.
  // Safe to call after the ownership check above.
  const comments = await getTicketComments(ticket.ref, { externalOnly: true });

  return (
    <div>
      <div className="p-crumb">
        <Link href="/portal">My tickets</Link> · <b>{ticket.ref}</b>
      </div>

      <div className="p-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 className="p-h1">{ticket.subject || ticket.ref}</h1>
          <div className="p-sub">
            <span className="p-ticket-ref">{ticket.ref}</span>
            {ticket.createdAt ? <> · opened {when(ticket.createdAt)}</> : null}
          </div>
        </div>
        <span className={`p-pill ${statusClass(ticket.status)}`}>
          <span className="dot" aria-hidden />
          {humanize(ticket.status)}
        </span>
      </div>

      <div className="p-section-h">Conversation</div>
      <div className="p-card">
        {comments.length === 0 ? (
          <div className="p-sub">No messages yet. Add a reply below and the team will respond here.</div>
        ) : (
          <div className="p-timeline">
            {comments.map((c) => {
              const mine = isCustomer(c.kind);
              const author = mine ? 'You' : (c.author || 'Support');
              return (
                <div className="p-msg" key={c.id}>
                  <div className="p-avatar">{author.charAt(0).toUpperCase()}</div>
                  <div className="p-msg-body">
                    <div className="p-msg-head">
                      <span className="p-msg-author">{author}</span>
                      <span className="p-msg-when">{when(c.createdAt)}</span>
                    </div>
                    <div className="p-msg-text">{c.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-section-h">Reply</div>
      <div className="p-card">
        <ReplyBox refId={ticket.ref} />
      </div>
    </div>
  );
}
