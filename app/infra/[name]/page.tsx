import { containers, type Container } from '@/lib/mock';
import { LinksPanel, type Edge } from '@/components/LinksPanel';
import { getEdges } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const stateTag: Record<string, [string, string]> = {
  running: ['st-done', 'Running'], paused: ['st-prog', 'Paused'], stopped: ['st-open', 'Stopped'],
};

const trend = [62, 71, 58, 80, 74, 66, 91, 78];

// Mock log tail — later streamed from `docker logs` via the socket-proxy.
const logLines: { t: string; lvl: 'info' | 'warn' | 'error'; msg: string }[] = [
  { t: '10:42:18', lvl: 'info', msg: 'GET /api/ping 200 in 4ms' },
  { t: '10:41:55', lvl: 'warn', msg: 'memory usage 91% of limit (466/512 MB)' },
  { t: '10:39:02', lvl: 'error', msg: 'ECONNRESET upstream docker-socket-proxy:2375' },
  { t: '10:38:47', lvl: 'info', msg: 'request completed /findings 200 in 38ms' },
  { t: '10:35:10', lvl: 'error', msg: 'UnhandledRejection: TimeoutError after 5000ms at fetchStats()' },
  { t: '10:33:29', lvl: 'warn', msg: 'slow query: ops.findings select took 812ms' },
  { t: '10:31:22', lvl: 'info', msg: 'health probe ok' },
  { t: '10:30:01', lvl: 'error', msg: 'restart policy triggered (exit 1) — attempt 1/3' },
];
const lvlColor: Record<string, string> = { info: 'var(--muted)', warn: 'var(--high)', error: 'var(--crit)' };

export default async function ContainerDetail({ params }: { params: Promise<{ name: string }> }) {
  await requireGlobalAdminPage();
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  // Detail stats (CPU/mem/trend) are still mock — only the container LIST on
  // /infra is live. If this container isn't in the mock set (e.g. a real one
  // from the socket-proxy), fall back to a minimal card derived from the name.
  const c: Container =
    containers.find((x) => x.name === decoded) ?? {
      name: decoded,
      component: decoded.split(/[_.]/)[0] || decoded,
      state: 'running',
      cpu: 0,
      mem: 0,
      memLimit: 0,
      restarts: 0,
      node: '—',
    };
  const [scls, slab] = stateTag[c.state] ?? ['st-mute', c.state];
  const memPct = c.memLimit > 0 ? Math.min(100, Math.round((c.mem / c.memLimit) * 100)) : 0;

  // Real edges from ops.links keyed on the container name; fall back to a derived
  // part-of-component edge so the panel is never empty.
  const realEdges = await getEdges('container', c.name);
  const edges: Edge[] = realEdges.length > 0
    ? realEdges
    : [{ rel: 'runs_on', type: 'component', id: c.component, label: `${c.component} component`, href: `/components/${encodeURIComponent(c.component)}` }];

  return (
    <div>
      <div className="spread mb">
        <div className="h1 mono">{c.name}</div>
        <span className={`tag ${scls}`}>{slab}</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="grid grid-4 mb">
            <div className="card"><div className="k">CPU</div><div className="v">{c.cpu}%</div></div>
            <div className="card"><div className="k">Memory</div><div className="v" style={{ fontSize: 18 }}>{c.mem}/{c.memLimit}</div><div className="track" style={{ marginTop: 8 }}><div className="fill" style={{ width: `${memPct}%`, background: 'var(--blue, #2D6CFF)' }} /></div></div>
            <div className="card"><div className="k">Restarts</div><div className="v">{c.restarts}</div></div>
            <div className="card"><div className="k">Uptime</div><div className="v" style={{ fontSize: 18 }}>6d 4h</div></div>
          </div>

          <div className="card mb">
            <div className="panel-h"><h3>Memory trend (last 8 samples)</h3></div>
            <div className="row" style={{ alignItems: 'flex-end', gap: 8, height: 90 }}>
              {trend.map((v, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div className="fill" style={{ height: `${v}%`, borderRadius: 4, background: 'var(--blue, #2D6CFF)' }} />
                </div>
              ))}
            </div>
          </div>

          <div className="card mb">
            <div className="panel-h">
              <div className="row" style={{ gap: 10 }}>
                <h3>Logs</h3>
                <span className="tag st-open">{logLines.filter((l) => l.lvl === 'error').length} errors</span>
                <span className="tag st-prog">{logLines.filter((l) => l.lvl === 'warn').length} warnings</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip on" style={{ padding: '4px 10px' }}>All</span>
                <span className="chip" style={{ padding: '4px 10px' }}>Errors</span>
                <span className="chip" style={{ padding: '4px 10px' }}>Warnings</span>
              </div>
            </div>
            <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12, lineHeight: 1.75, overflow: 'auto', maxHeight: 260, margin: 0 }}>
              {logLines.map((l, i) => (
                <div key={i}>
                  <span style={{ color: 'var(--faint)' }}>{l.t}</span>{'  '}
                  <span style={{ color: lvlColor[l.lvl], fontWeight: 700 }}>{l.lvl.toUpperCase().padEnd(5)}</span>{'  '}
                  <span style={{ color: l.lvl === 'info' ? 'var(--text)' : lvlColor[l.lvl] }}>{l.msg}</span>
                </div>
              ))}
            </pre>
            <div className="sub mt">Last 8 lines · streams from <span className="mono">docker logs</span> via the socket-proxy (read-only).</div>
          </div>

          <div className="card">
            <div className="panel-h"><h3>Lifecycle</h3></div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost sm">Stop</button>
              <button className="btn ghost sm">Restart</button>
              <button className="btn ghost sm">Pause</button>
            </div>
            <div className="sub mt">Actions require a typed confirmation phrase and are audited.</div>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Component</span><span>{c.component}</span></div>
              <div className="r"><span className="k2">Node</span><span className="mono">{c.node}</span></div>
              <div className="r"><span className="k2">State</span><span><span className={`tag ${scls}`}>{slab}</span></span></div>
              <div className="r"><span className="k2">Image</span><span className="mono" style={{ fontSize: 11 }}>ghcr.io/{c.component}:latest</span></div>
            </div>
          </div>
          <LinksPanel edges={edges} node={{ type: 'container', id: c.name }} />
        </div>
      </div>
    </div>
  );
}
