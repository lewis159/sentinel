import Link from 'next/link';
import { getCheckStats, getScanRuns } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const statusTag: Record<string, [string, string]> = {
  pass: ['st-done', 'Pass'], issues: ['st-prog', 'Issues'], failed: ['st-open', 'Failed'],
  complete: ['st-done', 'Complete'], running: ['st-done', 'Running'],
};

export default async function ScansPage() {
  await requireGlobalAdminPage();
  const { rows: checks, live, note } = await getCheckStats();
  const { rows: scanRuns } = await getScanRuns();
  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Scans &amp; Checks</div>
            <span className={`pill live-badge${live ? '' : ' mock'}`}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.findings' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">{checks.length} checks · security + ops · scheduled and on-demand</div>
        </div>
        <button className="btn">⟳ Run all</button>
      </div>

      <div className="card pad0 mb">
        <table>
          <thead><tr><th>Check</th><th>Type</th><th>Schedule</th><th>Last run</th><th>Status</th><th>Findings</th></tr></thead>
          <tbody>
            {checks.map((c) => {
              const [cls, lab] = statusTag[c.status] ?? ['st-mute', c.status];
              return (
                <tr key={c.key} className="clickable">
                  <td><Link href={`/scans/checks/${c.key}`}><div className="t">{c.name}</div><div className="d">{c.source}</div></Link></td>
                  <td><span className={`tag ${c.type === 'security' ? 'st-blue' : 'st-mute'}`}>{c.type}</span></td>
                  <td className="sub">{c.schedule}</td>
                  <td className="sub">{c.lastRun}</td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td style={{ fontWeight: 700 }}>{c.findings}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card pad0">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Recent runs</h3><Link className="link" href="/scans/runs">All runs →</Link></div>
        <table>
          <thead><tr><th>Run</th><th>Type</th><th>Findings</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {scanRuns.slice(0, 4).map((r) => {
              const [cls, lab] = statusTag[r.status] ?? ['st-mute', r.status];
              return (
                <tr key={r.id} className="clickable">
                  <td><Link href={`/scans/runs/${r.id}`}><span className="mono">#{r.id}</span></Link></td>
                  <td>{r.type}</td>
                  <td><span className="tag st-blue">{r.findings}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td className="sub">{r.when}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
