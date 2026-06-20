import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { Breadcrumb } from '@/components/Breadcrumb';
import { UserAccessPanel } from '@/components/UserAccessPanel';

export const dynamic = 'force-dynamic';

function rel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function actionLabel(a: string): string {
  switch (a) {
    case 'set_access': return 'Access change';
    case 'quota_request': return 'Limit increase requested';
    default: return a;
  }
}

// Per-user access panel: list of estate apps with the user's current level and a
// control to change/upgrade it, plus a "Request limit increase" action for
// metered apps, plus the access-change audit trail. global_admin only.
export default async function UserAccessDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;
  const { user, audit } = await getUserAccess(id);
  if (!user) return notFound();

  return (
    <div>
      <Breadcrumb items={[{ label: 'Operations' }, { label: 'Access' }, { label: 'Users', href: '/users' }, { label: user.name }]} />

      <div className="spread mb">
        <div>
          <div className="h1" style={{ marginBottom: 4 }}>{user.name}</div>
          <div className="sub">{user.email}</div>
        </div>
        <Link className="btn ghost sm" href="/users">← All users</Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <UserAccessPanel user={{ id: user.id, name: user.name, email: user.email, access: user.access, roles: user.roles, entitlements: user.entitlements }} />
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">User ID</span><span className="mono" style={{ fontSize: 11 }}>{user.id}</span></div>
              <div className="r"><span className="k2">Created</span><span>{user.createdAt ? rel(new Date(user.createdAt).toISOString()) : '—'}</span></div>
              <div className="r"><span className="k2">Last active</span><span>{user.lastActiveAt ? rel(new Date(user.lastActiveAt).toISOString()) : '—'}</span></div>
            </div>
          </div>

          <div className="card pad0">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Access changes</h3></div>
            {audit.length === 0 ? (
              <div style={{ padding: 16 }}><span className="sub">No recorded access changes.</span></div>
            ) : (
              <table>
                <thead><tr><th>When</th><th>Change</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="sub">{rel(a.createdAt)}</td>
                      <td>
                        <div className="t">{actionLabel(a.action)}{a.app ? ` · ${a.app}` : ''}</div>
                        <div className="d">
                          {a.oldValue ? `${a.oldValue} → ` : ''}{a.newValue ?? '—'}
                          {a.ref ? <> · <Link className="link" href={`/requests`}>{a.ref}</Link></> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
