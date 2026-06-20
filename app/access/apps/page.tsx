import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import { listUsers } from '@/lib/access';
import { ESTATE_APPS, type AccessLevel } from '@/lib/apps';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

// Apps index: one card per estate app with how its access is controlled and a
// count of users with access. Links into the per-app view. global_admin only.
export default async function AppsIndexPage() {
  await requireGlobalAdminPage();
  const { rows: users, live, note } = await listUsers();

  const controlLabel: Record<string, string> = {
    'role': 'Role (viewer/responder/admin)',
    'level': 'Level (none/viewer/admin)',
    'tier-readonly': 'Tier & quota — read-only (owned by YT)',
  };

  function countWithAccess(appId: string): number {
    return users.filter((u) => {
      const lvl = (u.access[appId] ?? 'none') as AccessLevel;
      return lvl !== 'none' || !!u.roles?.[appId] || !!u.entitlements?.[appId];
    }).length;
  }

  return (
    <div>
      <Breadcrumb items={[{ label: 'Operations' }, { label: 'Access' }, { label: 'Apps' }]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Apps</div>
            <LiveBadge live={live} table="Clerk · ops.user_app_access" note={note} />
          </div>
          <div className="sub">Per-app access — each app's control model and who has access</div>
        </div>
      </div>

      <div className="grid grid-3">
        {ESTATE_APPS.map((a) => (
          <Link key={a.id} className="card" href={`/access/apps/${a.id}`} style={{ textDecoration: 'none' }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{a.name}</span>
              {a.source === 'yt' && <span className="tag st-mute" title="Owned by YT">read-only</span>}
            </div>
            <div className="sub">{a.subdomain}</div>
            <div className="sub" style={{ marginTop: 6 }}>{controlLabel[a.accessControl]}</div>
            <div className="v" style={{ marginTop: 8 }}>{countWithAccess(a.id)}</div>
            <div className="sub">users with access</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
