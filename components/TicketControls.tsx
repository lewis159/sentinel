'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KIND_STATUSES, type TicketKind } from '@/lib/mock';

// Inline status + assignee editor on the ticket detail pane. PATCHes
// /api/tickets/<ref> then refreshes the server-rendered detail.
export function TicketControls({
  ref_, kind, status, assignee, embedded = false,
}: { ref_: string; kind: TicketKind; status: string; assignee: string; embedded?: boolean }) {
  const router = useRouter();
  const [statusVal, setStatusVal] = useState(status);
  const [assigneeVal, setAssigneeVal] = useState(assignee === '—' ? '' : assignee);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = statusVal !== status || (assigneeVal || '—') !== assignee;

  // Statuses for this kind, ensuring the current value is always selectable
  // (e.g. 'new' from the report-issue inbox isn't in the kind workflow list).
  const options = Array.from(new Set([status, ...KIND_STATUSES[kind]]));

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ref_)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusVal, assignee: assigneeVal.trim() || '—' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      setMsg('Saved');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error');
    }
    setBusy(false);
  }

  // `embedded` = rendered inside a dashboard Panel (which already supplies the
  // card chrome + header), so drop the outer .card and the "Update" panel header.
  const inner = (
    <>
      <div className="form-grid" style={{ marginTop: 4 }}>
        <div className="field">
          <label>Status</label>
          <select className="select" value={statusVal} onChange={(e) => setStatusVal(e.target.value)}>
            {options.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Assignee</label>
          <input className="input" value={assigneeVal} placeholder="unassigned"
            onChange={(e) => setAssigneeVal(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 4 }}>
        <button className="btn sm" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {msg && <span className="sub" style={{ color: '#5fd49b' }}>{msg}</span>}
        {err && <span className="form-err" style={{ margin: 0 }}>{err}</span>}
      </div>
    </>
  );

  if (embedded) return inner;
  return (
    <div className="card mb">
      <div className="panel-h"><h3>Update</h3></div>
      {inner}
    </div>
  );
}
