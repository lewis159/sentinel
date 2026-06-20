'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sevClass, sevLabel, type ServiceTicket } from '@/lib/mock';
import { AppTag } from './AppTag';

// Change Advisory Board queue: changes whose attrs.cab_status === 'pending',
// each with Approve / Reject buttons wired to /api/changes/<ref>/cab.
export function CabQueue({ changes }: { changes: ServiceTicket[] }) {
  const pending = changes.filter((c) => (c.attrs?.cab_status ?? '') === 'pending');

  return (
    <div className="card mb">
      <div className="panel-h">
        <h3>CAB queue</h3>
        <span className="kanban-count">{pending.length} pending</span>
      </div>
      {pending.length === 0 ? (
        <div className="placeholder" style={{ padding: 24 }}>
          <div className="big">✓</div>Nothing awaiting CAB approval.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pending.map((c) => <CabRow key={c.ref} change={c} />)}
        </div>
      )}
    </div>
  );
}

function CabRow({ change }: { change: ServiceTicket }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const risk = String(change.attrs?.risk ?? '—');
  const changeType = String(change.attrs?.change_type ?? 'normal');
  const window_ = change.attrs?.window ? String(change.attrs.window) : null;

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision); setErr(null);
    try {
      const res = await fetch(`/api/changes/${encodeURIComponent(change.ref)}/cab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(null); return; }
      setDone(decision === 'approve' ? 'Approved' : 'Rejected');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error');
      setBusy(null);
    }
  }

  return (
    <div className="kanban-card" style={{ cursor: 'default' }}>
      <div className="kanban-card-top">
        <span className="mono" style={{ fontSize: 11 }}>{change.ref}</span>
        <AppTag app={change.app} />
      </div>
      <div className="kanban-card-title">{change.title}</div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <span className={`pill ${sevClass[change.priority]}`} style={{ fontSize: 10.5 }}>● {sevLabel[change.priority]}</span>
        <span className="tag st-mute" style={{ fontSize: 10 }}>Risk: {risk}</span>
        <span className="tag st-mute" style={{ fontSize: 10 }}>{changeType}</span>
        {window_ && <span className="tag st-blue" style={{ fontSize: 10 }}>⧖ {window_}</span>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {done ? (
          <span className={`sub ${done === 'Approved' ? 'fg-ok' : 'fg-crit'}`}>{done}</span>
        ) : (
          <>
            <button className="btn sm" onClick={() => decide('approve')} disabled={busy !== null}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button className="btn sm ghost" onClick={() => decide('reject')} disabled={busy !== null}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </>
        )}
        {err && <span className="form-err" style={{ margin: 0 }}>{err}</span>}
      </div>
    </div>
  );
}
