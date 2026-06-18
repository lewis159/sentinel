import Link from 'next/link';

export type Edge = { rel: string; type: string; id: string; label: string; href: string };

const TYPE_ICON: Record<string, string> = {
  ticket: '🎫', component: '⬡', kb: '📘', scan: '◎', finding: '⚠', container: '◷', user: '◰',
};

// The graph-navigation panel that appears on every detail page.
export function LinksPanel({ edges }: { edges: Edge[] }) {
  return (
    <div className="card links-panel">
      <div className="panel-h"><h3>Linked</h3><span className="sub">graph</span></div>
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
    </div>
  );
}
