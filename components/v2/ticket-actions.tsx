'use client';

// Actionable client islands for the v2 ITIL detail pane. These mount INSIDE the
// server-rendered ServiceTicketDetail and drive the real write APIs:
//   - TicketComposer     → POST /api/tickets/[ref]/comments  { body }
//   - TicketStatusControl→ PATCH /api/tickets/[ref]          { status }
// After a successful write they call router.refresh() so the server component
// re-fetches its timeline / row. In this dev env there's no DATABASE_URL, so the
// APIs 500 ("no DB"); we surface that inline rather than crash.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { KIND_STATUSES, type TicketKind } from '@/lib/mock';

import './ticket-actions.css';

const NO_DB = "Couldn't save — no database in this environment.";

// Statuses for a kind, tolerant of an arbitrary string coming from the row.
function statusesFor(kind: string): string[] {
  return KIND_STATUSES[kind as TicketKind] ?? [];
}

// The workflow's terminal state, if one exists — used for the quick "Resolve".
function resolvedStatusFor(kind: string): string | null {
  const list = statusesFor(kind);
  return (
    list.find((s) => s === 'resolved') ??
    list.find((s) => s === 'closed') ??
    null
  );
}

function humanize(v: string): string {
  return (v ?? '').toString().replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// TicketComposer — post a free-text update to a ticket's timeline.
// ---------------------------------------------------------------------------
export function TicketComposer({ refId }: { refId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePost() {
    const body = text.trim();
    if (!body || posting) return;

    setPosting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(refId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(res.status >= 500 ? NO_DB : data?.error || `Post failed (${res.status}).`);
        setPosting(false);
        return;
      }

      setText('');
      setPosting(false);
      router.refresh();
    } catch {
      setError('Network error — could not post update.');
      setPosting(false);
    }
  }

  return (
    <div className="v2-ta-composer">
      <textarea
        className="v2-ta-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Post an update to ${refId}…`}
        disabled={posting}
      />
      {error && <div className="v2-ta-err">{error}</div>}
      <div className="v2-ta-composer-foot">
        <button
          type="button"
          className="v2-btn"
          onClick={handlePost}
          disabled={posting || !text.trim()}
        >
          {posting ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketStatusControl — change a ticket's workflow status via PATCH.
// ---------------------------------------------------------------------------
export function TicketStatusControl({
  refId,
  kind,
  status,
}: {
  refId: string;
  kind: string;
  status: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = statusesFor(kind);
  // Guarantee the current value is selectable even if it's off the known list.
  const selectable = options.includes(current) ? options : [current, ...options];
  const resolved = resolvedStatusFor(kind);
  const showResolve = !!resolved && current !== resolved;

  async function applyStatus(next: string) {
    if (next === current || saving) return;

    const prev = current;
    setCurrent(next); // optimistic
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(refId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setCurrent(prev); // roll back
        setError(res.status >= 500 ? NO_DB : data?.error || `Save failed (${res.status}).`);
        setSaving(false);
        return;
      }

      setSaving(false);
      setSaved(true);
      router.refresh();
    } catch {
      setCurrent(prev);
      setError('Network error — could not save.');
      setSaving(false);
    }
  }

  return (
    <div className="v2-ta-status">
      <select
        className="v2-ta-select"
        value={current}
        onChange={(e) => applyStatus(e.target.value)}
        disabled={saving}
        aria-label="Ticket status"
      >
        {selectable.map((s) => (
          <option key={s} value={s}>
            {humanize(s)}
          </option>
        ))}
      </select>

      {showResolve && (
        <button
          type="button"
          className="v2-btn ghost"
          onClick={() => applyStatus(resolved!)}
          disabled={saving}
        >
          Resolve
        </button>
      )}

      {saving && <span className="v2-ta-state">Saving…</span>}
      {!saving && saved && !error && <span className="v2-ta-state">Saved</span>}
      {error && <span className="v2-ta-err inline">{error}</span>}
    </div>
  );
}
