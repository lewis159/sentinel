import { GraphView } from '@/components/GraphView';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const RELATIONS = [
  { rel: 'affects', desc: 'finding → component' },
  { rel: 'raises', desc: 'finding → ticket' },
  { rel: 'runs_on', desc: 'component → container' },
  { rel: 'documents', desc: 'kb → finding' },
  { rel: 'related', desc: 'ticket → ticket' },
];

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  await requireGlobalAdminPage();
  const { node } = await searchParams;

  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Graph</div><div className="sub">Explore how everything connects</div></div>
      </div>

      <GraphView focus={node} />

      <div className="card mt" style={{ marginTop: 16 }}>
        <div className="panel-h"><h3>Relation types</h3></div>
        <div className="row wrap" style={{ gap: 16 }}>
          {RELATIONS.map((r) => (
            <div key={r.rel} className="row" style={{ gap: 7 }}>
              <span className="rel">{r.rel}</span>
              <span className="sub">{r.desc}</span>
            </div>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 12 }}>
          Findings, the tickets they raise, the components and containers they run on, and the runbooks that document them — fed live from <span className="mono">ops.links</span>.
        </div>
      </div>
    </div>
  );
}
