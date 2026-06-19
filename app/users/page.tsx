import { requireGlobalAdminPage } from '@/lib/auth';
import { listUsers } from '@/lib/access';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LiveBadge } from '@/components/LiveBadge';
import { UsersList } from '@/components/UsersList';
import { ESTATE_APPS } from '@/lib/apps';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

// User & App Access Management — list estate users (from the Clerk Backend API),
// each with their current per-app access (read from the Sentinel ops DB, the
// source of truth). Select a user to manage their access. global_admin only.
export default async function UsersPage() {
  await requireGlobalAdminPage();
  const { rows: users, live, note } = await listUsers();
  const withAccess = users.filter((u) => ESTATE_APPS.some((a) => (u.access[a.id] ?? 'none') !== 'none')).length;

  return (
    <div>
      <AutoRefresh source="users" />
      <Breadcrumb items={[{ label: 'Operations' }, { label: 'Access' }, { label: 'Users' }]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">User &amp; App Access</div>
            <LiveBadge live={live} table="Clerk · ops.user_app_access" note={note} />
          </div>
          <div className="sub">Manage which estate apps each user can access · source of truth is the Sentinel DB, mirrored to Clerk</div>
        </div>
      </div>

      <div className="grid grid-3 mb">
        <div className="card"><div className="k">Estate users</div><div className="v">{users.length}</div><div className="sub">{live ? 'from Clerk' : 'mock'}</div></div>
        <div className="card"><div className="k">With estate access</div><div className="v">{withAccess}</div><div className="sub">≥ 1 app grant</div></div>
        <div className="card"><div className="k">Managed apps</div><div className="v">{ESTATE_APPS.length}</div><div className="sub">registry-driven</div></div>
      </div>

      <UsersList users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, access: u.access }))} />
    </div>
  );
}
