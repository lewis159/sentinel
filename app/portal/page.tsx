import Link from 'next/link';
import { requirePortalSession } from '@/lib/portal/auth';
import { listPortalTickets } from '@/lib/portal/tickets';

export const dynamic = 'force-dynamic';

// Humanise a status/kind token for display ("in_progress" → "in progress").
function humanize(v: string): string {
  return (v ?? '').toString().replace(/_/g, ' ');
}

// Relative "time ago" from an ISO string. Returns '' for a missing value.
function ago(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Normalise a status to one of the pill style buckets.
function statusClass(status: string): string {
  const s = (status ?? '').toLowerCase();
  if (['resolved', 'closed', 'fulfilled', 'implemented', 'done', 'completed'].includes(s)) return 'resolved';
  if (['in_progress', 'investigating', 'awaiting_cab', 'building', 'staged'].includes(s)) return 'in_progress';
  return 'open';
}

export default async function PortalHome() {
  const session = await requirePortalSession();
  const tickets = await listPortalTickets(session.tenantRef);

  return (
    <div>
      <div className="p-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 className="p-h1">My tickets</h1>
          <div className="p-sub">Your open and recent support requests.</div>
        </div>
        <Link className="p-btn" href="/portal/new">New request</Link>
      </div>

      {tickets.length === 0 ? (
        <div className="p-empty">
          <div className="big">No tickets yet</div>
          <div>When you submit a request it will appear here.</div>
        </div>
      ) : (
        <div className="p-list">
          {tickets.map((t) => (
            <Link className="p-ticket" href={`/portal/tickets/${encodeURIComponent(t.ref)}`} key={t.ref}>
              <div className="p-ticket-main">
                <div className="p-ticket-subject">{t.subject || t.ref}</div>
                <div className="p-ticket-meta">
                  <span className="p-ticket-ref">{t.ref}</span>
                  {t.updatedAt ? <> · updated {ago(t.updatedAt)}</> : null}
                </div>
              </div>
              <span className={`p-pill ${statusClass(t.status)}`}>
                <span className="dot" aria-hidden />
                {humanize(t.status)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
