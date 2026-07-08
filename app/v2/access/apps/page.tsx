import '../access.css';
import { requireSectionPage } from '@/lib/auth';
import { listUsers } from '@/lib/access';
import { ESTATE_APPS, type AccessLevel } from '@/lib/apps';

export const dynamic = 'force-dynamic';

// ADMIN · Access → Apps. One card per estate app (from the real ESTATE_APPS
// registry in lib/apps.ts) with its subdomain, how access is controlled, and a
// live count of users who can reach it. The count comes from lib/access.ts
// listUsers() — DB/Clerk-first with a mock fallback, so this renders without a
// DB wired. Read-only view; provisioning happens on the per-user Access screen.

// How each app's access is controlled → a short human label for the card.
const CONTROL_LABEL: Record<string, string> = {
  role: 'Role — viewer / responder / admin',
  level: 'Level — none / viewer / admin',
  'tier-readonly': 'Tier & quota — read-only (owned by YT)',
};

// Short human descriptions keyed by the registry id. Kept here (not in the
// registry) because they are UI copy, not access model.
const APP_DESC: Record<string, string> = {
  yt: 'YouTube transcription platform (Scribuo). Tier + monthly quota are owned by YT; Sentinel shows them read-only.',
  bruce: 'Bruce Springsteen news aggregator. Straightforward none/viewer/admin access, owned by Sentinel.',
  sentinel: 'This ops & security console. Per-app role controls who can respond and administer inside Sentinel.',
};

// Two-letter monogram for the card logo from the app name.
function monogram(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default async function V2AppsAccessPage() {
  await requireSectionPage('admin');

  const { rows: users } = await listUsers();

  // A user "has access" to an app if they carry any non-none level, any per-app
  // role, or any read-through entitlement (e.g. a YT tier).
  function countWithAccess(appId: string): number {
    return users.filter((u) => {
      const lvl = (u.access[appId] ?? 'none') as AccessLevel;
      return lvl !== 'none' || !!u.roles?.[appId] || !!u.entitlements?.[appId];
    }).length;
  }

  return (
    <div>
      {/* Header */}
      <div className="v2-acc-head">
        <div>
          <div className="v2-eyebrow">Admin · Access</div>
          <h1 className="v2-h1">Apps</h1>
          <div className="v2-sub">Applications in the estate and who can reach them</div>
        </div>
      </div>

      {/* App cards */}
      <div className="v2-acc-grid">
        {ESTATE_APPS.map((a) => (
          <div key={a.id} className="v2-acc-app">
            <div className="v2-acc-app-top">
              <span className="v2-acc-logo">{monogram(a.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="v2-acc-name">{a.name}</div>
                <div className="v2-acc-sub">{a.subdomain}</div>
              </div>
              {a.source === 'yt' && (
                <span className="v2-acc-badge" title="Access owned by YT" style={{ marginLeft: 'auto' }}>
                  Read-only
                </span>
              )}
            </div>

            <div className="v2-acc-desc">{APP_DESC[a.id] ?? 'Estate application.'}</div>

            <div className="v2-acc-ctl">
              <b>Control:</b> {CONTROL_LABEL[a.accessControl] ?? a.accessControl}
              {a.metered && a.metricLabel ? ` · ${a.metricLabel}` : ''}
            </div>

            <div className="v2-acc-foot">
              <span className="v2-acc-count">{countWithAccess(a.id)}</span>
              <span className="v2-acc-count-lab">users with access</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
