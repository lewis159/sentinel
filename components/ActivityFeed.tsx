'use client';

import { useCallback, useEffect, useState } from 'react';

// Activity timeline + add-update composer for one ITIL ticket. Loads the
// updates/comments feed from /api/tickets/<ref>/comments on mount and whenever
// `ref_` changes; the composer POSTs a new update and refreshes the list.
type Comment = { id: string; author: string; kind: string; body: string; createdAt: string };

function rel(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityFeed({ ref_ }: { ref_: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ref_)}/comments`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setItems([]); }
      else setItems(Array.isArray(data.comments) ? data.comments : []);
    } catch (e: any) {
      setErr(e?.message ?? 'Network error');
      setItems([]);
    }
    setLoading(false);
  }, [ref_]);

  useEffect(() => { load(); }, [load]);

  async function post() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ref_)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      if (data?.comment) setItems((prev) => [...prev, data.comment]);
      else await load();
      setDraft('');
    } catch (e: any) {
      setErr(e?.message ?? 'Network error');
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="act-list">
        {loading && <div className="sub">Loading activity…</div>}
        {!loading && items.length === 0 && <div className="sub">No updates yet.</div>}
        {!loading && items.map((c) => (
          <div className="act-item" key={c.id}>
            <div className="act-head">
              <span className="act-author">{c.author}</span>
              <span className={`act-badge ${c.kind === 'update' ? 'is-update' : ''}`}>{c.kind}</span>
              <span className="act-time">{rel(c.createdAt)}</span>
            </div>
            <div className="act-body">{c.body}</div>
          </div>
        ))}
      </div>

      <div className="act-composer">
        <textarea
          className="textarea"
          placeholder="Add an update…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button className="btn sm" onClick={post} disabled={busy || !draft.trim()}>
            {busy ? 'Posting…' : 'Post update'}
          </button>
          {err && <span className="form-err" style={{ margin: 0 }}>{err}</span>}
        </div>
      </div>
    </div>
  );
}
