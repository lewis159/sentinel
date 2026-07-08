// Shared ITIL list — one reusable table for the incidents / requests / problems
// / releases sections. Server component: pulls its own rows via
// getTicketsByKind(kind) (DB-first with a mock fallback, so it always renders)
// and links each row to the per-kind detail route. Styling lives in
// app/v2/incidents/itil.css (namespaced v2-itil-*); tokens come from v2.css.

import Link from 'next/link';
import { getTicketsByKind } from '@/lib/data';
import type { TicketKind, ServiceTicket } from '@/lib/mock';
import '@/app/v2/incidents/itil.css';

type Props = {
  kind: TicketKind;
  title: string;
  subtitle: string;
};

// Detail-route base per kind. Incidents live at /v2/incidents; every other kind
// pluralises (requests / problems / releases / changes). The detail page may not
// exist yet — the list still links to where it will be.
function detailBase(kind: TicketKind): string {
  return kind === 'incident' ? '/v2/incidents' : `/v2/${kind}s`;
}

// Map a ticket priority band onto the v2-pill variant classes.
function priorityClass(priority: string): 'crit' | 'high' | 'info' {
  if (priority === 'critical') return 'crit';
  if (priority === 'high') return 'high';
  return 'info';
}

export default async function ItilList({ kind, title, subtitle }: Props) {
  const { rows } = await getTicketsByKind(kind);
  const base = detailBase(kind);

  const open = rows.filter(
    (r: ServiceTicket) => r.status !== 'closed' && r.status !== 'resolved',
  ).length;

  return (
    <div className="v2-itil-page">
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Operations · Service management</div>
        <h1 className="v2-h1">{title}</h1>
        <div className="v2-sub">
          {subtitle} · {rows.length} total · {open} open
        </div>
      </div>

      {/* List */}
      <div className="v2-card v2-itil-table-wrap">
        {rows.length === 0 ? (
          <div className="v2-itil-empty">No {title.toLowerCase()} yet.</div>
        ) : (
          <table className="v2-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Status</th>
                <th>App</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ServiceTicket) => {
                const href = `${base}/${r.ref}`;
                return (
                  <tr key={r.ref}>
                    <td>
                      <Link href={href} className="v2-itil-ref">{r.ref}</Link>
                    </td>
                    <td>
                      <Link href={href} className="v2-itil-title">{r.title}</Link>
                    </td>
                    <td>
                      <span className={`v2-pill ${priorityClass(r.priority)}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td>
                      <span className="v2-itil-tag">{r.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="v2-itil-app">{r.app}</td>
                    <td className="v2-itil-age">{r.age}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
