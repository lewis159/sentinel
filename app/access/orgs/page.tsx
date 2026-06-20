import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import { listOrgs } from '@/lib/access';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

// Organizations (read-only) — mirror of Clerk Organizations + members. Phase 1
// is READ-ONLY; ops.orgs/org_members are a mirror written by a future reconcile,
// not by this view. global_admin only.
export default async function OrgsPage() {
  await requireGlobalAdminPage();
  const { rows: orgs, live, note } = await listOrgs();

  return (
    <div>
      <Breadcrumb items={[{ label: 'Operations' }, { label: 'Access' }, { label: 'Organizations' }]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Organizations</div>
            <LiveBadge live={live} table="Clerk · ops.orgs" note={note} />
          </div>
          <div className="sub">Clerk Organizations and their members · read-only in Phase 1</div>
        </div>
      </div>

      {orgs.length === 0 ? (
        <div className="card"><span className="sub">No organizations.</span></div>
      ) : (
        orgs.map((o) => (
          <div key={o.id} className="card pad0 mb">
            <div className="panel-h" style={{ padding: '14px 16px' }}>
              <div className="row" style={{ gap: 8 }}>
                <h3 style={{ margin: 0 }}>{o.name}</h3>
                <span className="tag st-mute">{o.membersCount} member{o.membersCount === 1 ? '' : 's'}</span>
              </div>
            </div>
            {o.members.length === 0 ? (
              <div style={{ padding: 16 }}><span className="sub">No members loaded.</span></div>
            ) : (
              <table>
                <thead><tr><th>Member</th><th>Org role</th></tr></thead>
                <tbody>
                  {o.members.map((m) => (
                    <tr key={m.userId}>
                      <td>
                        <Link className="link" href={`/users/${encodeURIComponent(m.userId)}`}>{m.label}</Link>
                      </td>
                      <td>{m.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}
