'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Minimal "Apply grant" action for an approved request ticket. POSTs to
// /api/tickets/[ref]/grant → grantOnApproval. For ops-owned apps (Sentinel/Bruce)
// it applies the grant; for YT it records intent only (YT owns tier/credits —
// apply via the YT admin API in Phase 2). global_admin only (enforced server-side).
//
// NOTE (wiring): this renders on the request-ticket detail reference line. The
// main ticket body is a draggable react-grid dashboard (TicketDashboard); a
// deeper integration (an "Access request" tile with the resolved target/level)
// is a follow-up — see grantOnApproval in lib/access.ts. TODO: surface the
// resolved target user + level here once the request ticket carries grant_app.
export function ApplyGrantButton({ ref }: { ref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function apply() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ref)}/grant`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      setMsg(data?.applied ? 'Grant applied.' : (data?.note ?? 'Recorded (apply in owning app).'));
      setBusy(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn ghost sm" onClick={apply} disabled={busy}>
        {busy ? 'Applying…' : 'Apply grant'}
      </button>
      {msg && <span className="sub" style={{ color: 'var(--ok)' }}>{msg}</span>}
      {err && <span className="sub" style={{ color: 'var(--high)' }}>{err}</span>}
    </div>
  );
}
