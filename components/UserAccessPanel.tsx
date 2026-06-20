'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ESTATE_APPS, ACCESS_LEVEL_LABEL, APP_ROLES, APP_ROLE_LABEL,
  type AccessLevel, type AppRole, type EstateAppDef,
} from '@/lib/apps';
import { QuotaRequestModal } from './QuotaRequestModal';

// Entitlement shape mirrors lib/access.ts Entitlement (display-only).
type Entitlement = {
  tier: string | null;
  quotaLimit: number | null;
  quotaUsed: number | null;
  quotaPeriod: string | null;
  synced: boolean;
};

type UserLite = {
  id: string;
  name: string;
  email: string;
  access: Record<string, AccessLevel>;
  roles: Record<string, AppRole>;
  entitlements: Record<string, Entitlement>;
};

function levelTagClass(level: AccessLevel): string {
  switch (level) {
    case 'admin': return 'st-blue';
    case 'viewer': return 'st-mute';
    default: return 'st-mute';
  }
}

// Format a YT-style read-only badge: "Pro · 47/100" or "not synced".
function entitlementBadge(ent: Entitlement | undefined): string {
  if (!ent || !ent.synced) return 'not synced';
  const tier = ent.tier ?? '—';
  if (ent.quotaUsed != null && ent.quotaLimit != null) {
    return `${tier} · ${ent.quotaUsed}/${ent.quotaLimit}`;
  }
  return tier;
}

// One row per estate app. The CONTROL rendered depends on def.accessControl:
//   'level'         → Bruce: none/viewer/admin select (writes access_level).
//   'role'          → Sentinel: viewer/responder/admin select (writes app_role).
//   'tier-readonly' → YT: read-only tier+quota badge from entitlements + request.
function AppAccessControl({
  user, def, level, role, entitlement, onChanged,
}: {
  user: UserLite;
  def: EstateAppDef;
  level: AccessLevel;
  role: AppRole | undefined;
  entitlement: Entitlement | undefined;
  onChanged: () => void;
}) {
  const [value, setValue] = useState<AccessLevel>(level);
  const [roleValue, setRoleValue] = useState<AppRole>(role ?? 'viewer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);

  async function patch(payload: Record<string, any>, rollback: () => void) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: def.id, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { rollback(); setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      setBusy(false);
      if (data?.mirrored === false) setErr('Saved to DB; Clerk mirror pending (will reconcile).');
      onChanged();
    } catch (e: any) {
      rollback(); setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  // Bruce: change the coarse access level.
  function changeLevel(next: AccessLevel) {
    const prev = value; setValue(next);
    patch({ level: next }, () => setValue(prev));
  }

  // Sentinel: change the per-app role. We send a baseline access level so the
  // estate-app session claim still reflects access; the role is the new bit.
  function changeRole(next: AppRole) {
    const prev = roleValue; setRoleValue(next);
    const derivedLevel: AccessLevel = next === 'viewer' ? 'viewer' : 'admin';
    setValue(derivedLevel);
    patch({ level: derivedLevel, appRole: next }, () => { setRoleValue(prev); });
  }

  const ctrl = def.accessControl;

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{def.name}</span>
            {ctrl === 'role' ? (
              <span className="tag st-blue">{APP_ROLE_LABEL[roleValue]}</span>
            ) : ctrl === 'tier-readonly' ? (
              <span className={`tag ${entitlement?.synced ? 'st-blue' : 'st-mute'}`} title="Owned by YT — read-only">
                {entitlementBadge(entitlement)}
              </span>
            ) : (
              <span className={`tag ${levelTagClass(value)}`}>{ACCESS_LEVEL_LABEL[value]}</span>
            )}
            {def.metered && <span className="tag st-mute" title={def.metricLabel}>metered</span>}
          </div>
          <div className="sub">
            {def.subdomain}
            {ctrl === 'role' && ' · role does not change the global_admin gate yet'}
            {ctrl === 'tier-readonly' && ' · tier & quota owned by YT (read-only)'}
            {ctrl === 'level' && def.metered && def.metricLabel ? ` · ${def.metricLabel}` : ''}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {ctrl === 'level' && (
            <select
              className="select" value={value} disabled={busy}
              onChange={(e) => changeLevel(e.target.value as AccessLevel)}
              aria-label={`Access level for ${def.name}`} style={{ minWidth: 130 }}
            >
              {(['none', 'viewer', 'admin'] as AccessLevel[]).map((l) => (
                <option key={l} value={l}>{ACCESS_LEVEL_LABEL[l]}</option>
              ))}
            </select>
          )}

          {ctrl === 'role' && (
            <select
              className="select" value={roleValue} disabled={busy}
              onChange={(e) => changeRole(e.target.value as AppRole)}
              aria-label={`Role for ${def.name}`} style={{ minWidth: 130 }}
            >
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>{APP_ROLE_LABEL[r]}</option>
              ))}
            </select>
          )}

          {ctrl === 'tier-readonly' && (
            <button className="btn ghost sm" onClick={() => setQuotaOpen(true)} disabled={busy}>
              Request limit increase
            </button>
          )}
          {ctrl !== 'tier-readonly' && def.metered && (
            <button className="btn ghost sm" onClick={() => setQuotaOpen(true)} disabled={busy}>
              Request limit increase
            </button>
          )}
        </div>
      </div>
      {err && <div className="sub" style={{ color: 'var(--high)', marginTop: 8 }}>{err}</div>}
      {quotaOpen && (
        <QuotaRequestModal
          userId={user.id}
          userLabel={user.email || user.name}
          app={def}
          onClose={() => setQuotaOpen(false)}
        />
      )}
    </div>
  );
}

export function UserAccessPanel({ user }: { user: UserLite }) {
  const router = useRouter();
  const onChanged = () => router.refresh();

  return (
    <div>
      <div className="panel-h">
        <h3>App access</h3>
        <span className="sub">Changes apply across the estate within ~1 minute</span>
      </div>
      {ESTATE_APPS.map((a) => (
        <AppAccessControl
          key={a.id}
          user={user}
          def={a}
          level={(user.access[a.id] ?? 'none') as AccessLevel}
          role={user.roles?.[a.id]}
          entitlement={user.entitlements?.[a.id]}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
