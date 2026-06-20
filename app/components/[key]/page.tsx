import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneComponent, getEdges } from '@/lib/data';
import { LinksPanel } from '@/components/LinksPanel';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const kindTag: Record<string, string> = { service: 'st-blue', infra: 'st-mute', route: 'st-prog' };

export default async function ComponentDetail({ params }: { params: Promise<{ key: string }> }) {
  await requireGlobalAdminPage();
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const { row: comp, live } = await getOneComponent(decoded);
  if (!comp) return notFound();

  const edges = await getEdges('component', comp.key);
  const containerEdges = edges.filter((e) => e.type === 'container');
  const findingEdges = edges.filter((e) => e.type === 'finding');

  return (
    <div>
      <div className="spread mb">
        <div className="crumb">
          <Link className="link" href="/components">Components</Link> · <b>{comp.key}</b>
          <span className={`pill live-badge${live ? '' : ' mock'}`} style={{ marginLeft: 10 }}>
            <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
            {live ? 'LIVE · ops.components' : 'mock'}
          </span>
        </div>
        <span className={`tag ${kindTag[comp.kind] ?? 'st-mute'}`}>{comp.kind}</span>
      </div>

      <div className="card mb">
        <div className="h1" style={{ marginBottom: 6 }}>{comp.name}</div>
        <div className="sub"><span className="mono">{comp.key}</span> · {comp.findings} findings · {comp.containers} containers</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card pad0 mb">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Containers</h3></div>
            <table>
              <thead><tr><th>Name</th><th>Relation</th></tr></thead>
              <tbody>
                {containerEdges.length === 0 && <tr><td colSpan={2} className="sub" style={{ padding: 16 }}>No containers linked — this may be a logical route / module, or topology hasn’t reconciled yet.</td></tr>}
                {containerEdges.map((e) => (
                  <tr key={e.id} className="clickable">
                    <td><Link href={e.href}><span className="mono">{e.id}</span></Link></td>
                    <td><span className="rel">{e.rel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card pad0">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Findings</h3></div>
            <table>
              <thead><tr><th>Finding</th><th>Relation</th></tr></thead>
              <tbody>
                {findingEdges.length === 0 && <tr><td colSpan={2} className="sub" style={{ padding: 16 }}>No linked findings.</td></tr>}
                {findingEdges.map((e) => (
                  <tr key={e.id} className="clickable">
                    <td><Link href={e.href}><span className="mono">{e.id}</span> <span className="sub">— {e.label}</span></Link></td>
                    <td><span className="rel">{e.rel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <LinksPanel edges={edges} node={{ type: 'component', id: comp.key }} />
        </div>
      </div>
    </div>
  );
}
