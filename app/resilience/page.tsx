import { getResilienceRuns, RESILIENCE_CHECKS, type ResilienceRun } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const kindTag: Record<string, [string, string]> = {
  resilience: ['st-blue', 'Resilience'],
  security: ['st-open', 'Security'],
  scalability: ['st-prog', 'Scalability'],
};

function rel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

// Find the latest status for a given check key across all runs.
function latestFor(key: string, suite: string, runs: ResilienceRun[]) {
  for (const run of runs) {
    if (run.results && key in run.results) {
      return { passed: run.results[key].passed, detail: run.results[key].detail, ran_at: run.ran_at };
    }
    if (run.suite === key || run.suite === suite) {
      return { passed: run.passed, detail: '', ran_at: run.ran_at };
    }
  }
  return null;
}

function StatusPill({ passed }: { passed: boolean }) {
  return (
    <span className={`pill ${passed ? 'tint-ok' : 'tint-crit'}`}>
      <span className="dot" style={{ background: passed ? 'var(--ok)' : 'var(--crit)' }} />
      {passed ? 'PASS' : 'FAIL'}
    </span>
  );
}

export default async function ResiliencePage() {
  await requireGlobalAdminPage();
  const { rows: runs, live, note } = await getResilienceRuns();

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Resilience</div>
            <span className={`pill live-badge${live ? '' : ' mock'}`}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.resilience_runs' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">On-demand chaos, security &amp; scalability self-tests</div>
        </div>
      </div>

      {/* Check catalogue */}
      <div className="card pad0 mb">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Check catalogue</h3></div>
        <table>
          <thead><tr><th>Check</th><th>Kind</th><th>What it verifies</th><th>Latest</th><th>When</th></tr></thead>
          <tbody>
            {RESILIENCE_CHECKS.map((c) => {
              const [kcls, klab] = kindTag[c.kind] ?? ['st-mute', c.kind];
              const latest = latestFor(c.key, c.key, runs);
              return (
                <tr key={c.key}>
                  <td><div className="t">{c.name}</div><div className="d"><span className="mono">{c.key}</span></div></td>
                  <td><span className={`tag ${kcls}`}>{klab}</span></td>
                  <td className="sub" style={{ maxWidth: 360 }}>{c.desc}</td>
                  <td>{latest ? <StatusPill passed={latest.passed} /> : <span className="tag st-mute">never run</span>}</td>
                  <td className="sub">{latest ? rel(latest.ran_at) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Run history */}
      <div className="card pad0 mb">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Run history</h3></div>
        <table>
          <thead><tr><th>Run</th><th>Suite</th><th>Result</th><th>Duration</th><th>When</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><span className="mono">#{r.id}</span></td>
                <td><span className="mono" style={{ fontSize: 11 }}>{r.suite}</span></td>
                <td><StatusPill passed={r.passed} /></td>
                <td className="sub">{fmtDuration(r.duration_ms)}</td>
                <td className="sub">{rel(r.ran_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* How to run */}
      <div className="card">
        <div className="panel-h" style={{ marginBottom: 12 }}><h3>How to run</h3></div>
        <pre style={{ margin: 0, padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, overflowX: 'auto', fontSize: 12.5, lineHeight: 1.7 }}>
{`# Run every suite
bash scripts/resilience-check.sh all

# Or a single suite
bash scripts/resilience-check.sh db-failover
bash scripts/resilience-check.sh app-replica
bash scripts/resilience-check.sh worker
bash scripts/resilience-check.sh headers
bash scripts/resilience-check.sh scale`}
        </pre>
        <div className="sub" style={{ marginTop: 12 }}>
          Destructive runs (killing DB/app/worker containers) are operator-triggered from the CLI for safety — the console&apos;s Docker access is read-only.
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
          <button className="btn" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} title="CLI-only for now — run from the operator shell">▶ Run all</button>
          <span className="sub">CLI-only for now</span>
        </div>
      </div>
    </div>
  );
}
