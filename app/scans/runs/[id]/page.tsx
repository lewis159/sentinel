import Link from 'next/link';
import { notFound } from 'next/navigation';
import { scanRuns, findings, sevClass, sevLabel } from '@/lib/mock';

const statusTag: Record<string, [string, string]> = {
  complete: ['st-done', 'Complete'], running: ['st-done', 'Running'], failed: ['st-open', 'Failed'],
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], fixed: ['st-done', 'Fixed'],
};

export default async function ScanRunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = scanRuns.find((r) => r.id === id);
  if (!run) return notFound();
  const [cls, lab] = statusTag[run.status] ?? ['st-mute', run.status];
  const produced = findings.slice(0, 3);

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/scans/runs">Scan runs</Link> · <b>#{run.id}</b></div>
        <button className="btn ghost sm">⭳ Export log</button>
      </div>

      <div className="card mb">
        <div className="h1" style={{ marginBottom: 6 }}>{run.type}</div>
        <div className="sub">Run <span className="mono">#{run.id}</span> · {run.when}</div>
      </div>

      <div className="grid grid-4 mb">
        <div className="card"><div className="k">Status</div><div style={{ marginTop: 6 }}><span className={`tag ${cls}`}>{lab}</span></div></div>
        <div className="card"><div className="k">Duration</div><div className="v">{run.duration}</div></div>
        <div className="card"><div className="k">Type</div><div className="v" style={{ fontSize: 16 }}>{run.type}</div></div>
        <div className="card"><div className="k">Findings</div><div className="v">{run.findings}</div></div>
      </div>

      <div className="card mb" style={{ background: 'linear-gradient(135deg,rgba(45,108,255,.08),rgba(56,189,248,.05))', borderColor: 'rgba(45,108,255,.25)' }}>
        <div className="panel-h"><h3>Integrity</h3></div>
        <p style={{ color: '#c8cedb', lineHeight: 1.7 }}>Run executed in an isolated runner; results signed and stored immutably. Logs and produced findings are tamper-evident and auditable.</p>
      </div>

      <div className="card pad0">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Findings produced</h3></div>
        <table>
          <thead><tr><th>Severity</th><th>Finding</th><th>Component</th><th>Status</th></tr></thead>
          <tbody>
            {produced.map((f) => {
              const [fcls, flab] = statusTag[f.status] ?? ['st-mute', f.status];
              return (
                <tr key={f.ref} className="clickable">
                  <td><span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span></td>
                  <td><Link href={`/findings/${f.ref}`}><div className="t">{f.title}</div><div className="d">{f.ref}</div></Link></td>
                  <td><span className="mono">{f.component}</span></td>
                  <td><span className={`tag ${fcls}`}>{flab}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
