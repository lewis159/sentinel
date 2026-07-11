'use client';

// P3 — support desk assignment + escalation controls (client islands).
// Mount inside the server-rendered support ticket detail; they drive the real
// write APIs and refresh the server component on success:
//   - AssignControl    → POST /api/tickets/:ref/assign    { assignee }
//   - EscalateControl  → POST /api/tickets/:ref/escalate  { toLevel?, reason }
// Rendered ONLY when the server has already checked the caller's role (the page
// gates these behind the support-action authorization), so they assume they're
// allowed and surface API errors inline. In dev there's no DATABASE_URL, so the
// APIs report "no database" — shown inline rather than crashing.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import './ticket-actions.css';

export type StaffOption = {
  clerkUserId: string;
  displayName: string;
  tier: 'agent' | 'lead';
};

const NO_DB = "Couldn't save — no database in this environment.";

// ---------------------------------------------------------------------------
// AssignControl — pick the ticket owner from the staff roster.
// ---------------------------------------------------------------------------
export function AssignControl({
  refId,
  staff,
  current,
}: {
  refId: string;
  staff: StaffOption[];
  current: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: string) {
    if (next === value || saving) return;
    const prev = value;
    setValue(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(refId)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setValue(prev);
        setError(res.status >= 500 ? NO_DB : data?.error || `Assign failed (${res.status}).`);
        setSaving(false);
        return;
      }
      setSaving(false);
      router.refresh();
    } catch {
      setValue(prev);
      setError('Network error — could not assign.');
      setSaving(false);
    }
  }

  return (
    <div className="v2-ta-status">
      <select
        className="v2-ta-select"
        value={value}
        onChange={(e) => apply(e.target.value)}
        disabled={saving}
        aria-label="Assign ticket"
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.clerkUserId} value={s.clerkUserId}>
            {s.displayName}
            {s.tier === 'lead' ? ' (Lead)' : ''}
          </option>
        ))}
      </select>
      {saving && <span className="v2-ta-state">Saving…</span>}
      {error && <span className="v2-ta-err inline">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EscalateControl — bump the ticket up the ladder (L1 → L2 → human gate).
// ---------------------------------------------------------------------------
export function EscalateControl({ refId }: { refId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function escalate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(refId)}/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(res.status >= 500 ? NO_DB : data?.error || `Escalate failed (${res.status}).`);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(false);
      setReason('');
      setMsg(`Escalated to ${String(data.level ?? 'next tier').toUpperCase()}.`);
      router.refresh();
    } catch {
      setError('Network error — could not escalate.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="v2-ta-status">
        <button type="button" className="v2-btn ghost" onClick={() => setOpen(true)}>
          Escalate
        </button>
        {msg && <span className="v2-ta-state">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="v2-ta-composer" style={{ minWidth: 260 }}>
      <textarea
        className="v2-ta-textarea"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you escalating? (routed to the next tier)"
        disabled={busy}
      />
      {error && <div className="v2-ta-err">{error}</div>}
      <div className="v2-ta-composer-foot" style={{ gap: 8 }}>
        <button type="button" className="v2-btn" onClick={escalate} disabled={busy}>
          {busy ? 'Escalating…' : 'Escalate to next tier'}
        </button>
        <button type="button" className="v2-btn ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
