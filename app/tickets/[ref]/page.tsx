import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneTicket, getTicketEdges } from '@/lib/data';
import { sevClass, sevLabel } from '@/lib/mock';
import { LinksPanel } from '@/components/LinksPanel';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  open: 'var(--low)', in_progress: 'var(--high)', blocked: 'var(--muted)', resolved: 'var(--ok)', fixed: 'var(--ok)',
};

// Mock activity stream — comments are not yet persisted in ops.*.
const comments = [
  { author: 'ben', body: 'Picked this up. Spinning up a read-only socket proxy in a side container to test against staging first.', when: '2d ago' },
  { author: 'system', body: 'Linked to finding — severity critical. SLA clock started.', when: '2d ago' },
  { author: 'ben', body: 'Proxy works locally. Need to confirm the compose override does not touch the other stacks on the host.', when: '1d ago' },
  { author: 'mara', body: 'Reviewed the override — looks scoped correctly. Approving once the verify scan is green.', when: '4h ago' },
];

export default async function TicketDetail({ params }: { params: Promise<{ ref: string }> }) {
  await requireGlobalAdminPage();
  const { ref } = await params;
  const { row: t, live } = await getOneTicket(ref);
  if (!t) return notFound();

  // Real edges from ops.links (both directions).
  const edges = await getTicketEdges(t.ref);

  return (
    <div>
      <div className="spread mb">
        <div className="crumb">
          <Link className="link" href="/tickets">Tickets</Link> · <b>{t.ref}</b>
          <span className={`pill live-badge${live ? '' : ' mock'}`} style={{ marginLeft: 10 }}>
            <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
            {live ? 'LIVE · ops.tickets' : 'mock'}
          </span>
        </div>
        <div className="row"><button className="btn ghost sm">Assign to me</button><button className="btn sm">Resolve</button></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card mb">
            <span className={`pill ${sevClass[t.priority]}`}>● {sevLabel[t.priority]} priority</span>
            <div className="h1" style={{ margin: '12px 0 6px' }}>{t.title}</div>
            <div className="row wrap sub" style={{ gap: 16 }}>
              <span>Ref <b style={{ color: 'var(--text)' }}>{t.ref}</b></span>
              <span>Type <b style={{ color: 'var(--text)' }}>{t.type}</b></span>
              <span>Source <b style={{ color: 'var(--text)' }}>{t.source}</b></span>
              <span>Opened <b style={{ color: 'var(--text)' }}>{t.age} ago</b></span>
            </div>
          </div>

          <div className="card mb">
            <div className="panel-h"><h3>Description</h3></div>
            <p style={{ color: 'var(--text)', lineHeight: 1.7 }}>
              {t.title}. This ticket tracks the remediation work and is linked to its originating {t.source}. Progress, approvals and the verification scan are recorded in the activity stream below.
            </p>
          </div>

          <div className="card">
            <div className="panel-h"><h3>Activity</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {comments.map((c, i) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700 }}>{c.author[0].toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div className="row spread"><b style={{ fontSize: 12.5 }}>{c.author}</b><span className="sub" style={{ fontSize: 11 }}>{c.when}</span></div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3 }}>{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
            <div className="search" style={{ width: '100%' }}>Add a comment…</div>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Status</span><span style={{ fontWeight: 600, color: statusColor[t.status] ?? 'var(--text)' }}>{t.status}</span></div>
              <div className="r"><span className="k2">Priority</span><span style={{ fontWeight: 700 }}>{sevLabel[t.priority]}</span></div>
              <div className="r"><span className="k2">Assignee</span><span>{t.assignee}</span></div>
              <div className="r"><span className="k2">Type</span><span>{t.type}</span></div>
              <div className="r"><span className="k2">Source</span><span>{t.source}</span></div>
              <div className="r"><span className="k2">SLA</span><span style={{ color: 'var(--high)' }}>18h remaining</span></div>
            </div>
          </div>
          <LinksPanel edges={edges} node={{ type: 'ticket', id: t.ref }} />
        </div>
      </div>
    </div>
  );
}
