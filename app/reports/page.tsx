import { getFindings, getTickets, getResilienceRuns } from '@/lib/data';
import { sevLabel, type Severity } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Same weighted score as scripts/build-posture-pdf.js, kept in sync by hand.
const SEV_WEIGHT: Record<Severity, number> = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };

const recent = [
  { name: 'Security posture — June', period: 'Jun 1 – Jun 16', generated: '2h ago' },
  { name: 'Monthly posture report', period: 'May 1 – May 31', generated: '16 days ago' },
  { name: 'Q2 access review', period: 'Apr 1 – Jun 30', generated: '6 days ago' },
];

export default async function ReportsPage() {
  await requireGlobalAdminPage();
  const [{ rows: findings, live: fLive }, { rows: tickets }, { rows: runs }] = await Promise.all([
    getFindings(),
    getTickets(),
    getResilienceRuns(1),
  ]);

  const live = fLive;
  const sevs: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const openBySev = sevs.reduce(
    (a, s) => ({ ...a, [s]: findings.filter((f) => f.severity === s && f.status !== 'fixed').length }),
    {} as Record<Severity, number>
  );
  const openFindings = sevs.reduce((a, s) => a + openBySev[s], 0);
  const penalty = sevs.reduce((a, s) => a + openBySev[s] * SEV_WEIGHT[s], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const openTickets = tickets.filter(
    (t) => !['resolved', 'closed', 'fixed'].includes(t.status)
  ).length;

  const lastRun = runs[0];

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Reports</div>
            <span className={`pill live-badge${live ? '' : ' mock'}`}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.findings' : 'mock'}
            </span>
          </div>
          <div className="sub">Posture snapshots, exports &amp; audit artefacts</div>
        </div>
      </div>

      <div className="grid grid-4 mb">
        <div className="card">
          <div className="k">Security score</div>
          <div className="v">{score}<span style={{ color: 'var(--muted)', fontSize: 18 }}> / 100</span></div>
          <div className="sub">weighted by open severity</div>
        </div>
        <div className="card">
          <div className="k">Open findings</div>
          <div className="v">{openFindings}</div>
          <div className="sub">
            <span style={{ color: 'var(--crit)' }}>{openBySev.critical} crit</span> ·{' '}
            <span style={{ color: 'var(--high)' }}>{openBySev.high} high</span> · {openBySev.medium} med
          </div>
        </div>
        <div className="card">
          <div className="k">Open tickets</div>
          <div className="v">{openTickets}</div>
          <div className="sub">{tickets.length} total</div>
        </div>
        <div className="card">
          <div className="k">Last resilience pass</div>
          <div className="v" style={{ color: lastRun ? (lastRun.passed ? 'var(--ok)' : 'var(--crit)') : 'var(--muted)' }}>
            {lastRun ? (lastRun.passed ? 'Pass' : 'Fail') : '—'}
          </div>
          <div className="sub">{lastRun ? `suite ${lastRun.suite}` : 'no runs'}</div>
        </div>
      </div>

      <div className="card mb insight-card">
        <div className="spread mb">
          <div>
            <div className="h2">Generate posture report</div>
            <div className="sub" style={{ maxWidth: 560, marginTop: 4 }}>
              A branded PDF built from LIVE data: security score, findings by severity, open critical/high list, ticket status and the latest resilience self-test. Ready to share with stakeholders.
            </div>
          </div>
          <a className="btn" href="/api/reports/posture">⭳ Generate PDF</a>
        </div>
        <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', margin: 0, fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 12.5, color: 'var(--text)', overflowX: 'auto' }}>
node scripts/build-posture-pdf.js
        </pre>
        <div className="sub" style={{ marginTop: 8 }}>
          Produces <span className="mono">documents/Sentinel_Posture_Report.pdf</span> via the operator build script (headless Chrome renders the HTML the script emits).
        </div>
      </div>

      <div className="card pad0">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Recent reports</h3></div>
        <table>
          <thead><tr><th>Report</th><th>Period</th><th>Generated</th><th></th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.name} className="clickable">
                <td><span className="t">{r.name}</span><div className="d">PDF · branded</div></td>
                <td className="mono" style={{ fontSize: 12 }}>{r.period}</td>
                <td className="sub">{r.generated}</td>
                <td style={{ textAlign: 'right' }}><span className="link">⭳ Download</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
