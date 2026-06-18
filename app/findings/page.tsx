import Link from 'next/link';
import { getFindings } from '@/lib/data';
import { sevClass, sevLabel, type Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], fixed: ['st-done', 'Fixed'], acknowledged: ['st-mute', 'Acknowledged'],
};

export default async function FindingsPage() {
  const { rows: findings, live, note } = await getFindings();
  const counts = (['critical', 'high', 'medium', 'low', 'info'] as Severity[]).reduce(
    (a, s) => ({ ...a, [s]: findings.filter((f) => f.severity === s).length }), {} as Record<Severity, number>
  );
  const openCount = findings.filter((f) => f.status !== 'fixed').length;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Findings</div>
            <span className="pill" style={{ background: live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)', color: live ? '#5fd49b' : '#aab3c4' }}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.findings' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">{openCount} open · sorted by severity</div>
        </div>
        <div className="row"><button className="btn ghost sm">⭳ Export</button><button className="btn sm">⟳ Run scan</button></div>
      </div>

      <div className="card pad0 mb" style={{ display: 'flex' }}>
        {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
          <div key={s} style={{ flex: 1, padding: '13px 18px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{counts[s]}</div>
            <div className="k">{sevLabel[s]}</div>
          </div>
        ))}
        <div style={{ flex: 1, padding: '13px 18px' }}><div style={{ fontSize: 20, fontWeight: 800 }}>{findings.length}</div><div className="k">Total</div></div>
      </div>

      <div className="row wrap mb" style={{ gap: 8 }}>
        <div className="search" style={{ flex: 1, minWidth: 240 }}>🔍 Search findings, components, CWE…</div>
        <div className="chip on">Critical</div><div className="chip on">High</div><div className="chip">Medium</div><div className="chip">Low</div>
        <div className="chip on">Open</div><div className="chip">In progress</div><div className="chip">Fixed</div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Severity</th><th>Finding</th><th>Component</th><th>CVSS</th><th>Source</th><th>Status</th><th>Age</th></tr></thead>
          <tbody>
            {findings.map((f) => {
              const [cls, lab] = statusTag[f.status] ?? ['st-mute', f.status];
              return (
                <tr key={f.ref} className="clickable">
                  <td><span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span></td>
                  <td><Link href={`/findings/${f.ref}`}><div className="t">{f.title}</div><div className="d">{f.ref} · {f.desc}</div></Link></td>
                  <td><span className="mono">{f.component}</span></td>
                  <td style={{ fontWeight: 700 }}>{f.cvss || '—'}</td>
                  <td><span className="mono" style={{ fontSize: 11 }}>{f.source}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td className="sub">{f.age}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
