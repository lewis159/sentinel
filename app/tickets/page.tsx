import Link from 'next/link';
import { getTickets } from '@/lib/data';
import { sevClass, sevLabel } from '@/lib/mock';

export const dynamic = 'force-dynamic';

const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], blocked: ['st-mute', 'Blocked'],
  resolved: ['st-done', 'Resolved'], fixed: ['st-done', 'Fixed'], acknowledged: ['st-mute', 'Acknowledged'],
};

export default async function TicketsPage() {
  const { rows: tickets, live, note } = await getTickets();

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Tickets</div>
            <span className="pill" style={{ background: live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)', color: live ? '#5fd49b' : '#aab3c4' }}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.tickets' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">Work queue · findings, alerts and incidents converge here</div>
        </div>
        <div className="row"><Link className="btn sm" href="/tickets/new">+ New ticket</Link></div>
      </div>

      <div className="row wrap mb" style={{ gap: 8 }}>
        <div className="search" style={{ flex: 1, minWidth: 240 }}>🔍 Search tickets…</div>
        <div className="chip">Bug</div><div className="chip">Task</div><div className="chip">Security</div>
        <div className="chip on">Open</div><div className="chip">In progress</div><div className="chip">Blocked</div><div className="chip">Resolved</div>
        <div className="chip on">Critical</div><div className="chip">High</div><div className="chip">Medium</div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Ref</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead>
          <tbody>
            {tickets.map((t) => {
              const [cls, lab] = statusTag[t.status] ?? ['st-mute', t.status];
              return (
                <tr key={t.ref} className="clickable">
                  <td><Link href={`/tickets/${t.ref}`}><span className="mono">{t.ref}</span></Link></td>
                  <td><Link href={`/tickets/${t.ref}`}><div className="t">{t.title}</div><div className="d">{t.source}{t.finding ? ` · ${t.finding}` : ''}</div></Link></td>
                  <td>{t.type}</td>
                  <td><span className={`pill ${sevClass[t.priority]}`}>● {sevLabel[t.priority]}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td>{t.assignee}</td>
                  <td className="sub">{t.age}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
