import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import { listUsers } from '@/lib/access';
import { getApp, ACCESS_LEVEL_LABEL, APP_ROLE_LABEL, type AccessLevel, type AppRole } from '@/lib/apps';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

// Per-app access view: every user with access to ONE estate app and their
// level/role/tier for it. Driven by the app's accessControl descriptor.
// global_admin only.
export default async function AppAccessPage({ params }: { params: Promise<{ app: string }> }) {
  await requireGlobalAdminPage();
  const { app } = await params;
  const found = getApp(app);
  if (!found) return notFound();
  const def = found; // non-null binding (used inside nested closures below)

  const { rows: users, live, note } = await listUsers();

  // Users with any access to this app (level !== none, or a role, or an entitlement).
  const withAccess = users.filter((u) => {
    const lvl = (u.access[def.id] ?? 'none') as AccessLevel;
    const role = u.roles?.[def.id];
    const ent = u.entitlements?.[def.id];
    return lvl !== 'none' || !!role || !!ent;
  });

  function cell(u: (typeof users)[number]) {
    if (def.accessControl === 'role') {
      const role = u.roles?.[def.id] as AppRole | undefined;
      return role ? APP_ROLE_LABEL[role] : ACCESS_LEVEL_LABEL[(u.access[def.id] ?? 'none') as AccessLevel];
    }
    if (def.accessControl === 'tier-readonly') {
      const ent = u.entitlements?.[def.id];
      if (!ent || !ent.synced) return 'not synced';
      const q = ent.quotaUsed != null && ent.quotaLimit != null ? ` · ${ent.quotaUsed}/${ent.quotaLimit}` : '';
      return `${ent.tier ?? '—'}${q}`;
    }
    return ACCESS_LEVEL_LABEL[(u.access[def.id] ?? 'none') as AccessLevel];
  }

  const colLabel =
    def.accessControl === 'role' ? 'Role'
      : def.accessControl === 'tier-readonly' ? 'Tier · quota'
        : 'Level';

  return (
    <div>
      <Breadcrumb items={[
        { label: 'Operations' }, { label: 'Access' },
        { label: 'Apps', href: '/access/apps' }, { label: def.name },
      ]} />

      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">{def.name} access</div>
            <LiveBadge live={live} table="Clerk · ops.user_app_access" note={note} />
          </div>
          <div className="sub">
            {def.subdomain} · {withAccess.length} user{withAccess.length === 1 ? '' : 's'} with access
            {def.source === 'yt' && ' · tier & quota owned by YT (read-only)'}
            {def.accessControl === 'role' && ' · role does not change the global_admin gate yet'}
          </div>
        </div>
        <Link className="btn ghost sm" href="/access/apps">← All apps</Link>
      </div>

      <div className="card pad0">
        {withAccess.length === 0 ? (
          <div style={{ padding: 16 }}><span className="sub">No users have access to {def.name}.</span></div>
        ) : (
          <table>
            <thead><tr><th>User</th><th>{colLabel}</th></tr></thead>
            <tbody>
              {withAccess.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link className="link" href={`/users/${encodeURIComponent(u.id)}`}>{u.name}</Link>
                    <div className="sub">{u.email}</div>
                  </td>
                  <td>{cell(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
