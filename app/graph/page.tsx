import { requireGlobalAdminPage } from '@/lib/auth';

const RELATIONS = [
  { rel: 'raises', desc: 'finding → ticket' },
  { rel: 'about', desc: 'finding → component' },
  { rel: 'runs_on', desc: 'component → container' },
  { rel: 'documents', desc: 'kb → finding' },
];

export default async function GraphPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Graph</div><div className="sub">Explore how everything connects</div></div>
      </div>

      <div className="card pad0 mb">
        <svg viewBox="0 0 800 420" style={{ width: '100%', display: 'block' }}>
          {/* edges */}
          <g stroke="#272D3A" strokeWidth="2" fill="none">
            <line x1="400" y1="90" x2="180" y2="190" />
            <line x1="400" y1="90" x2="400" y2="200" />
            <line x1="400" y1="90" x2="640" y2="190" />
            <line x1="400" y1="220" x2="280" y2="330" />
            <line x1="400" y1="220" x2="520" y2="330" />
            <line x1="640" y1="210" x2="400" y2="110" />
          </g>

          {/* relation labels */}
          <g fill="#8a93a6" fontSize="11" fontFamily="ui-monospace,monospace" textAnchor="middle">
            <text x="280" y="135">raises</text>
            <text x="412" y="155">about</text>
            <text x="538" y="135">documents</text>
            <text x="330" y="280">runs_on</text>
            <text x="470" y="280">runs_on</text>
            <text x="560" y="165">flags</text>
          </g>

          {/* nodes */}
          {/* finding (center top) */}
          <g>
            <rect x="340" y="62" width="120" height="48" rx="12" fill="#2D6CFF" />
            <text x="400" y="82" textAnchor="middle" fill="#cdd9ff" fontSize="10">⚠ finding</text>
            <text x="400" y="98" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">SEC-0009</text>
          </g>
          {/* ticket */}
          <g>
            <rect x="118" y="168" width="124" height="48" rx="12" fill="#1c2533" stroke="#2D6CFF" strokeWidth="1.5" />
            <text x="180" y="188" textAnchor="middle" fill="#7fa8ff" fontSize="10">🎫 ticket</text>
            <text x="180" y="204" textAnchor="middle" fill="#e7ecf5" fontSize="12" fontWeight="700">OPS-0007</text>
          </g>
          {/* component */}
          <g>
            <rect x="340" y="200" width="120" height="48" rx="12" fill="#1c2533" stroke="#2D6CFF" strokeWidth="1.5" />
            <text x="400" y="220" textAnchor="middle" fill="#7fa8ff" fontSize="10">⬡ component</text>
            <text x="400" y="236" textAnchor="middle" fill="#e7ecf5" fontSize="12" fontWeight="700">app</text>
          </g>
          {/* kb article */}
          <g>
            <rect x="578" y="168" width="128" height="48" rx="12" fill="#1c2533" stroke="#2D6CFF" strokeWidth="1.5" />
            <text x="642" y="188" textAnchor="middle" fill="#7fa8ff" fontSize="10">📘 kb article</text>
            <text x="642" y="204" textAnchor="middle" fill="#e7ecf5" fontSize="11" fontWeight="700">docker-socket</text>
          </g>
          {/* container 1 */}
          <g>
            <circle cx="280" cy="350" r="34" fill="#1c2533" stroke="#272D3A" strokeWidth="1.5" />
            <text x="280" y="346" textAnchor="middle" fill="#7fa8ff" fontSize="9">◷ container</text>
            <text x="280" y="360" textAnchor="middle" fill="#e7ecf5" fontSize="10" fontWeight="700">yt_app.1</text>
          </g>
          {/* container 2 */}
          <g>
            <circle cx="520" cy="350" r="34" fill="#1c2533" stroke="#272D3A" strokeWidth="1.5" />
            <text x="520" y="346" textAnchor="middle" fill="#7fa8ff" fontSize="9">◷ container</text>
            <text x="520" y="360" textAnchor="middle" fill="#e7ecf5" fontSize="10" fontWeight="700">yt_app.2</text>
          </g>
          {/* user */}
          <g>
            <circle cx="642" cy="290" r="34" fill="#1c2533" stroke="#272D3A" strokeWidth="1.5" />
            <text x="642" y="286" textAnchor="middle" fill="#7fa8ff" fontSize="9">◰ user</text>
            <text x="642" y="300" textAnchor="middle" fill="#e7ecf5" fontSize="10" fontWeight="700">james.m</text>
          </g>
        </svg>
      </div>

      <div className="card">
        <div className="panel-h"><h3>Relation types</h3></div>
        <div className="row wrap" style={{ gap: 16 }}>
          {RELATIONS.map((r) => (
            <div key={r.rel} className="row" style={{ gap: 7 }}>
              <span className="rel">{r.rel}</span>
              <span className="sub">{r.desc}</span>
            </div>
          ))}
        </div>
        <div className="sub mt" style={{ marginTop: 12 }}>Explore how everything connects — findings, the tickets they raise, the components and containers they run on, and the runbooks that document them.</div>
      </div>
    </div>
  );
}
