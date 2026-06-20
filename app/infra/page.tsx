import Link from 'next/link';
import { getContainers } from '@/lib/docker';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const stateTag: Record<string, [string, string]> = {
  running: ['st-done', 'Running'], paused: ['st-prog', 'Paused'], stopped: ['st-open', 'Stopped'],
  exited: ['st-open', 'Exited'], created: ['st-mute', 'Created'], restarting: ['st-prog', 'Restarting'], dead: ['st-open', 'Dead'],
};

export default async function InfraPage() {
  await requireGlobalAdminPage();
  const { rows: containers, live } = await getContainers();

  const totalMem = containers.reduce((a, c) => a + c.mem, 0);
  const totalLimit = containers.reduce((a, c) => a + c.memLimit, 0);
  const avgCpu = containers.length ? Math.round(containers.reduce((a, c) => a + c.cpu, 0) / containers.length) : 0;
  const restarts = containers.reduce((a, c) => a + c.restarts, 0);
  // Node count = DISTINCT real swarm node ids only. 'standalone' is the sentinel
  // for "no swarm node label" (see lib/docker.ts) and must not inflate the count.
  // If there are no real swarm nodes but standalone containers exist, the host
  // itself is one node — so report 1 rather than 0.
  const standaloneCount = containers.filter((c) => c.node === 'standalone').length;
  const realNodes = new Set(
    containers.map((c) => c.node).filter((n) => n !== 'standalone')
  ).size;
  const nodes = realNodes > 0 ? realNodes : standaloneCount > 0 ? 1 : 0;
  const standaloneNote = standaloneCount > 0 ? ` · ${standaloneCount} standalone` : '';
  const memKnown = totalLimit > 0;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Infrastructure</div>
            <span className={`pill live-badge${live ? '' : ' mock'}`}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · docker-socket-proxy' : 'mock'}
            </span>
          </div>
          <div className="sub">{containers.length} containers · {nodes} node{nodes === 1 ? '' : 's'}{standaloneNote} · live capacity</div>
        </div>
        <button className="btn ghost sm">⟳ Refresh</button>
      </div>

      <div className="grid grid-3 mb">
        <div className="card"><div className="k">Containers running</div><div className="v">{containers.length}</div><div className="sub">across {nodes} node{nodes === 1 ? '' : 's'}</div></div>
        <div className="card"><div className="k">Avg CPU</div><div className="v">{memKnown || avgCpu ? `${avgCpu}%` : '—'}</div><div className="sub">{restarts} restarts</div></div>
        <div className="card"><div className="k">Memory in use</div><div className="v">{memKnown ? <>{totalMem} <span style={{ color: 'var(--muted)', fontSize: 16 }}>/ {totalLimit} MB</span></> : '—'}</div><div className="sub">{memKnown ? `${Math.round((totalMem / totalLimit) * 100)}% of allocated` : 'stats not available'}</div></div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Name</th><th>Component</th><th>State</th><th>CPU</th><th>Memory</th><th>Restarts</th><th>Node</th></tr></thead>
          <tbody>
            {containers.map((c) => {
              const [cls, lab] = stateTag[c.state] ?? ['st-mute', c.state];
              const pct = c.memLimit > 0 ? Math.min(100, Math.round((c.mem / c.memLimit) * 100)) : 0;
              return (
                <tr key={c.name} className="clickable">
                  <td><Link href={`/infra/${c.name}`}><span className="mono">{c.name}</span></Link></td>
                  <td>{c.component}</td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td style={{ fontWeight: 700 }}>{c.memLimit > 0 || c.cpu ? `${c.cpu}%` : '—'}</td>
                  <td>
                    {c.memLimit > 0 ? (
                      <>
                        <div className="track" style={{ marginBottom: 4 }}><div className="fill" style={{ width: `${pct}%`, background: 'var(--blue, #2D6CFF)' }} /></div>
                        <div className="sub mono">{c.mem} / {c.memLimit} MB</div>
                      </>
                    ) : (
                      <div className="sub mono">—</div>
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>{c.restarts}</td>
                  <td>
                    {c.node === 'standalone'
                      ? <span className="tag st-mute">standalone</span>
                      : <span className="mono sub">{c.node.slice(0, 12)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
