'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ESTATE_APPS, ACCESS_LEVELS, ACCESS_LEVEL_LABEL, type AccessLevel } from '@/lib/apps';
import { QuotaRequestModal } from './QuotaRequestModal';

type UserLite = {
  id: string;
  name: string;
  email: string;
  access: Record<string, AccessLevel>;
};

function levelTagClass(level: AccessLevel): string {
  switch (level) {
    case 'admin': return 'st-blue';
    case 'viewer': return 'st-mute';
    default: return 'st-mute';
  }
}

// One row per estate app: shows the user's current level (read from the DB via
// the server), a select to change it (PATCH /api/users/[id]/access), and — for
// metered apps — a "Request limit increase" action that opens a ticket modal.
function AppAccessControl({
  user, appId, level, onChanged,
}: {
  user: UserLite;
  appId: string;
  level: AccessLevel;
  onChanged: () => void;
}) {
  const def = ESTATE_APPS.find((a) => a.id === appId)!;
  const [value, setValue] = useState<AccessLevel>(level);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);

  async function change(next: AccessLevel) {
    const prev = value;
    setValue(next); setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: appId, level: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setValue(prev); setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      setBusy(false);
      if (data?.mirrored === false) setErr('Saved to DB; Clerk mirror pending (will reconcile).');
      onChanged();
    } catch (e: any) {
      setValue(prev); setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{def.name}</span>
            <span className={`tag ${levelTagClass(value)}`}>{ACCESS_LEVEL_LABEL[value]}</span>
            {def.metered && <span className="tag st-mute" title={def.metricLabel}>metered</span>}
          </div>
          <div className="sub">{def.subdomain}{def.metered && def.metricLabel ? ` · ${def.metricLabel}` : ''}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            value={value}
            disabled={busy}
            onChange={(e) => change(e.target.value as AccessLevel)}
            aria-label={`Access level for ${def.name}`}
            style={{ minWidth: 130 }}
          >
            {ACCESS_LEVELS.map((l) => (
              <option key={l} value={l}>{ACCESS_LEVEL_LABEL[l]}</option>
            ))}
          </select>
          {def.metered && (
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
          appId={a.id}
          level={(user.access[a.id] ?? 'none') as AccessLevel}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
