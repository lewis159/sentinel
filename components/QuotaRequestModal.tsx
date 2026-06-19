'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EstateAppDef } from '@/lib/apps';

// Modal for requesting a usage-limit increase on a metered estate app (e.g. YT
// transcription limit). POSTs to /api/users/[id]/quota-request, which opens a
// service-request ticket in the ITIL module and links it back to the user.
export function QuotaRequestModal({
  userId, userLabel, app, onClose,
}: {
  userId: string;
  userLabel: string;
  app: EstateAppDef;
  onClose: () => void;
}) {
  const router = useRouter();
  const [currentLimit, setCurrentLimit] = useState('');
  const [requestedLimit, setRequestedLimit] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestedLimit.trim()) { setErr('Requested limit is required.'); return; }
    if (!reason.trim()) { setErr('Reason is required.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/quota-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: app.id, targetUserLabel: userLabel,
          currentLimit: currentLimit.trim() || undefined,
          requestedLimit: requestedLimit.trim(), reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      setOk(data?.ref ?? 'created');
      setBusy(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h3>Request limit increase — {app.name}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {ok ? (
          <div className="modal-body">
            <div className="card" style={{ borderLeft: '3px solid var(--ok)' }}>
              <div style={{ fontWeight: 700 }}>Service request {ok} created</div>
              <div className="sub">It now appears under Operations › Service management › Requests, where it can be actioned and closed.</div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-body">
              {err && <div className="form-err">{err}</div>}
              <div className="field">
                <label>User</label>
                <input className="input" value={userLabel} disabled />
              </div>
              <div className="field">
                <label>{app.metricLabel ?? 'Limit'}</label>
                <div className="form-grid">
                  <input className="input" value={currentLimit}
                    onChange={(e) => setCurrentLimit(e.target.value)} placeholder="Current (optional)" />
                  <input className="input" value={requestedLimit}
                    onChange={(e) => setRequestedLimit(e.target.value)} placeholder="Requested" autoFocus />
                </div>
              </div>
              <div className="field">
                <label>Reason</label>
                <textarea className="textarea" value={reason}
                  onChange={(e) => setReason(e.target.value)} placeholder="Why is the increase needed?" />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn sm" disabled={busy}>{busy ? 'Submitting…' : 'Create request'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
