import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checks, findings, sevClass, sevLabel } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

const statusTag: Record<string, [string, string]> = {
  pass: ['st-done', 'Pass'], issues: ['st-prog', 'Issues'], failed: ['st-open', 'Failed'],
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], fixed: ['st-done', 'Fixed'],
};

const runHistory = [
  { id: '1042', when: '14m ago', result: '1 issue' },
  { id: '1031', when: '6h ago', result: '0 issues' },
  { id: '1020', when: '1d ago', result: '2 issues' },
  { id: '1004', when: '2d ago', result: '1 issue' },
];

export default async function CheckDetail({ params }: { params: Promise<{ key: string }> }) {
  await requireGlobalAdminPage();
  const { key } = await params;
  const check = checks.find((c) => c.key === key);
  if (!check) return notFound();
  const [scls, slab] = statusTag[check.status] ?? ['st-mute', check.status];
  const checkFindings = findings.filter((f) => f.source === check.source);

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/scans">Scans</Link> · <b>{check.key}</b></div>
        <button className="btn sm">⟳ Run now</button>
      </div>

      <div className="card mb">
        <span className={`tag ${check.type === 'security' ? 'st-blue' : 'st-mute'}`}>{check.type}</span>
        <div className="h1" style={{ margin: '12px 0 4px' }}>{check.name}</div>
        <div className="sub">Source <span className="mono">{check.source}</span></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div className="card pad0">
          <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Findings from this check</h3></div>
          <table>
            <thead><tr><th>Severity</th><th>Finding</th><th>Component</th><th>Status</th></tr></thead>
            <tbody>
              {checkFindings.length === 0 && <tr><td colSpan={4} className="sub" style={{ padding: 16 }}>No open findings — check is clean.</td></tr>}
              {checkFindings.map((f) => {
                const [cls, lab] = statusTag[f.status] ?? ['st-mute', f.status];
                return (
                  <tr key={f.ref} className="clickable">
                    <td><span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span></td>
                    <td><Link href={`/findings/${f.ref}`}><div className="t">{f.title}</div><div className="d">{f.ref}</div></Link></td>
                    <td><span className="mono">{f.component}</span></td>
                    <td><span className={`tag ${cls}`}>{lab}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Type</span><span>{check.type}</span></div>
              <div className="r"><span className="k2">Schedule</span><span>{check.schedule}</span></div>
              <div className="r"><span className="k2">Last run</span><span>{check.lastRun}</span></div>
              <div className="r"><span className="k2">Status</span><span><span className={`tag ${scls}`}>{slab}</span></span></div>
              <div className="r"><span className="k2">Source</span><span className="mono">{check.source}</span></div>
            </div>
          </div>
          <div className="card">
            <div className="panel-h"><h3>Run history</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {runHistory.map((r) => (
                <div key={r.id} className="spread">
                  <Link className="link" href={`/scans/runs/${r.id}`}><span className="mono">#{r.id}</span></Link>
                  <span className="sub">{r.result}</span>
                  <span className="sub">{r.when}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
