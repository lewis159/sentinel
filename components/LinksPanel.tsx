'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type Edge = { rel: string; type: string; id: string; label: string; href: string };

const TYPE_ICON: Record<string, string> = {
  ticket: '🎫', component: '⬡', kb: '📘', scan: '◎', finding: '⚠', container: '◷', user: '◰', alert: '🔔',
};

// The node this panel belongs to, so it can deep-link into the graph focused on
// this node and offer a manual "Link…" action (POST /api/links).
export type PanelNode = { type: string; id: string };

// Manual relations the picker offers, keyed by the panel node's type. Mirrors the
// vocab in db/init/08_links_graph.sql; only the manual ones are offered here (the
// spine is auto-created). Each entry: { relation, dstType } for src=this node.
const MANUAL_LINKS: Record<string, { relation: string; dstType: string; label: string }[]> = {
  kb: [
    { relation: 'documents', dstType: 'finding', label: 'documents finding' },
    { relation: 'runbook_for', dstType: 'component', label: 'runbook for component' },
  ],
  ticket: [
    { relation: 'related', dstType: 'ticket', label: 'related ticket' },
    { relation: 'mitigates', dstType: 'finding', label: 'mitigates finding' },
  ],
  finding: [],
  component: [],
  container: [],
};

// The graph-navigation panel that appears on every detail page. `node` enables
// the "Open in graph" deep-link and the manual "Link…" picker.
export function LinksPanel({ edges, node }: { edges: Edge[]; node?: PanelNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState(0);
  const [targetId, setTargetId] = useState('');

  const manualOpts = node ? (MANUAL_LINKS[node.type] ?? []) : [];
  const graphHref = node ? `/graph?node=${encodeURIComponent(`${node.type}:${node.id}`)}` : null;

  async function submit() {
    if (!node) return;
    const opt = manualOpts[choice];
    if (!opt || !targetId.trim()) { setErr('Pick a relation and enter a target id.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          srcType: node.type, srcId: node.id,
          dstType: opt.dstType, dstId: targetId.trim(),
          relation: opt.relation,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setErr(json?.error ?? `HTTP ${res.status}`); return; }
      setOpen(false); setTargetId('');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'link failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card links-panel">
      <div className="panel-h">
        <h3>Linked</h3>
        <span className="sub">graph</span>
      </div>

      {edges.length === 0 && <div className="sub">No links yet.</div>}
      {edges.map((e, i) => (
        <Link key={i} href={e.href} className="edge">
          <span className="rel">{e.rel}</span>
          <span>{TYPE_ICON[e.type] ?? '•'}</span>
          <span style={{ flex: 1 }}>
            <span className="mono" style={{ color: '#7fa8ff' }}>{e.id}</span>
            <span style={{ color: 'var(--muted)' }}> — {e.label}</span>
          </span>
          <span style={{ color: 'var(--faint)' }}>→</span>
        </Link>
      ))}

      {node && (
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {graphHref && (
            <Link href={graphHref} className="btn ghost sm">⬡ Open in graph</Link>
          )}
          {manualOpts.length > 0 && (
            <button className="btn ghost sm" onClick={() => { setOpen((o) => !o); setErr(null); }}>
              ＋ Link…
            </button>
          )}
        </div>
      )}

      {open && manualOpts.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select
            className="search"
            value={choice}
            onChange={(e) => setChoice(Number(e.target.value))}
            style={{ width: '100%' }}
          >
            {manualOpts.map((o, i) => (
              <option key={o.relation + o.dstType} value={i}>{o.label}</option>
            ))}
          </select>
          <input
            className="search"
            placeholder={`Target ${manualOpts[choice]?.dstType ?? ''} id/ref/slug`}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ width: '100%' }}
          />
          {err && <div className="sub" style={{ color: 'var(--crit, #ff5d5d)' }}>{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" disabled={busy} onClick={submit}>{busy ? 'Linking…' : 'Create link'}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
