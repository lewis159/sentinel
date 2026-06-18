import Link from 'next/link';
import { notFound } from 'next/navigation';
import { components, containers, findings, sevClass, sevLabel } from '@/lib/mock';
import { LinksPanel } from '@/components/LinksPanel';

const kindTag: Record<string, string> = { service: 'st-blue', infra: 'st-mute', route: 'st-prog' };
const stateTag: Record<string, [string, string]> = {
  running: ['st-done', 'Running'], paused: ['st-prog', 'Paused'], stopped: ['st-open', 'Stopped'],
};
const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], fixed: ['st-done', 'Fixed'],
};

const runbooks = [
  { slug: 'docker-socket-proxy', title: 'Hardening the Docker socket with a read-only proxy' },
  { slug: 'incident-response', title: 'Incident response checklist' },
];

export default async function ComponentDetail({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const comp = components.find((c) => c.key === decoded);
  if (!comp) return notFound();

  const compContainers = containers.filter((c) => c.component === comp.key);
  const compFindings = findings.filter((f) => f.component.includes(comp.key));

  const edges = [
    ...runbooks.map((r) => ({ rel: 'documented-by', type: 'kb', id: r.slug, label: r.title, href: `/kb/${r.slug}` })),
    ...compFindings.slice(0, 2).map((f) => ({ rel: 'has-finding', type: 'finding', id: f.ref, label: f.title, href: `/findings/${f.ref}` })),
  ];

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/components">Components</Link> · <b>{comp.key}</b></div>
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
              <thead><tr><th>Name</th><th>State</th><th>CPU</th><th>Node</th></tr></thead>
              <tbody>
                {compContainers.length === 0 && <tr><td colSpan={4} className="sub" style={{ padding: 16 }}>No containers — this is a logical route / module.</td></tr>}
                {compContainers.map((c) => {
                  const [cls, lab] = stateTag[c.state] ?? ['st-mute', c.state];
                  return (
                    <tr key={c.name} className="clickable">
                      <td><Link href={`/infra/${c.name}`}><span className="mono">{c.name}</span></Link></td>
                      <td><span className={`tag ${cls}`}>{lab}</span></td>
                      <td style={{ fontWeight: 700 }}>{c.cpu}%</td>
                      <td className="mono sub">{c.node}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card pad0">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Findings</h3></div>
            <table>
              <thead><tr><th>Severity</th><th>Finding</th><th>Status</th></tr></thead>
              <tbody>
                {compFindings.length === 0 && <tr><td colSpan={3} className="sub" style={{ padding: 16 }}>No open findings.</td></tr>}
                {compFindings.map((f) => {
                  const [cls, lab] = statusTag[f.status] ?? ['st-mute', f.status];
                  return (
                    <tr key={f.ref} className="clickable">
                      <td><span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span></td>
                      <td><Link href={`/findings/${f.ref}`}><div className="t">{f.title}</div><div className="d">{f.ref}</div></Link></td>
                      <td><span className={`tag ${cls}`}>{lab}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="panel-h"><h3>Runbooks</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {runbooks.map((r) => (
                <Link key={r.slug} className="link" href={`/kb/${r.slug}`}>📘 {r.title}</Link>
              ))}
            </div>
          </div>
          <LinksPanel edges={edges} />
        </div>
      </div>
    </div>
  );
}
