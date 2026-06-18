import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOneFinding, getFindingEdges } from '@/lib/data';
import { sevClass, sevLabel } from '@/lib/mock';
import { LinksPanel } from '@/components/LinksPanel';
import { RaiseTicketButton } from '@/components/RaiseTicketButton';
import { StatusSelect } from '@/components/StatusSelect';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function FindingDetail({ params }: { params: Promise<{ ref: string }> }) {
  await requireGlobalAdminPage();
  const { ref } = await params;
  const { row: f, live } = await getOneFinding(ref);
  if (!f) return notFound();
  const edges = await getFindingEdges(f.ref);

  return (
    <div>
      <div className="spread mb">
        <div className="crumb">
          <Link className="link" href="/findings">Findings</Link> · <b>{f.ref}</b>
          <span className="pill" style={{ marginLeft: 10, background: live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)', color: live ? '#5fd49b' : '#aab3c4' }}>
            <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
            {live ? 'LIVE · ops.findings' : 'mock'}
          </span>
        </div>
        <div className="row"><button className="btn ghost sm">Assign to me</button><RaiseTicketButton findingRef={f.ref} /></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card mb">
            <span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span>
            <div className="h1" style={{ margin: '12px 0 6px' }}>{f.title}</div>
            <div className="row wrap sub" style={{ gap: 16 }}>
              <span>ID <b style={{ color: 'var(--text)' }}>{f.ref}</b></span>
              <span>{f.cwe || 'no CWE'}</span>
              <span>Found by <b style={{ color: 'var(--text)' }}>{f.source}</b></span>
              <span>Opened <b style={{ color: 'var(--text)' }}>{f.age} ago</b></span>
            </div>
          </div>

          <div className="card mb" style={{ background: 'linear-gradient(135deg,rgba(45,108,255,.08),rgba(56,189,248,.05))', borderColor: 'rgba(45,108,255,.25)' }}>
            <div className="panel-h"><h3>✨ AI insight</h3></div>
            <p style={{ color: '#c8cedb', lineHeight: 1.7 }}>{f.desc}. This is the highest-impact class of issue for {f.component}; recommended remediation is generated below and can be promoted to a ticket. (Advisory — AI output is never auto-applied.)</p>
          </div>

          <div className="card mb">
            <div className="panel-h"><h3>Evidence</h3></div>
            <pre style={{ background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 12, color: '#c8cedb', overflow: 'auto' }}><code>{`# source: ${f.source}\ncomponent: ${f.component}\nseverity: ${f.severity}  cvss: ${f.cvss || 'n/a'}`}</code></pre>
          </div>

          <div className="card">
            <div className="panel-h"><h3>Remediation</h3></div>
            <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: '#c8cedb' }}>
              <li>Review the affected component and confirm the finding.</li>
              <li>Apply the recommended fix (see linked runbook).</li>
              <li>Re-run the <span className="mono">{f.source}</span> check to verify resolution.</li>
            </ol>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Status</span><StatusSelect findingRef={f.ref} status={f.status} /></div>
              <div className="r"><span className="k2">CVSS</span><span style={{ fontWeight: 700 }}>{f.cvss || '—'}</span></div>
              <div className="r"><span className="k2">Component</span><span className="mono">{f.component}</span></div>
              <div className="r"><span className="k2">Source</span><span>{f.source}</span></div>
              <div className="r"><span className="k2">Age</span><span>{f.age}</span></div>
            </div>
          </div>
          <LinksPanel edges={edges} />
        </div>
      </div>
    </div>
  );
}
