import '../components/infra.css';
import { requireSectionPage } from '@/lib/auth';
import { getResilienceRuns, RESILIENCE_CHECKS } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Operations · Infrastructure · Resilience. Renders inside the v2
// shell (.v2-shell > .v2-content); this file provides page content only. Shows
// the static self-test catalogue (RESILIENCE_CHECKS) as cards plus the recent
// run history (getResilienceRuns() → ops.resilience_runs, DB-first with a mock
// fallback). Shell classes from ../v2.css; page primitives from
// ../components/infra.css (namespaced v2-inf-).

const KIND_CLASS: Record<string, string> = {
  resilience: 'k-resilience', security: 'k-security', scalability: 'k-scalability',
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

export default async function V2ResiliencePage() {
  await requireSectionPage('operations');
  const { rows: runs, live } = await getResilienceRuns();

  return (
    <div>
      {/* Header */}
      <div className="v2-inf-head">
        <div>
          <div className="v2-eyebrow">Operations · Infrastructure</div>
          <div className="v2-inf-title">
            <h1 className="v2-h1">Resilience</h1>
            <span className={`v2-inf-badge${live ? ' live' : ''}`}>
              <span className="dot" />
              {live ? 'Live · ops.resilience_runs' : 'Mock'}
            </span>
          </div>
          <div className="v2-sub">On-demand chaos, security &amp; scalability self-tests</div>
        </div>
      </div>

      {/* Check catalogue */}
      <div className="v2-inf-sec">Check catalogue</div>
      <div className="v2-inf-cat">
        {RESILIENCE_CHECKS.map((c) => (
          <div key={c.key} className="v2-inf-catcard">
            <div className="top">
              <span className="nm">{c.name}</span>
              <span className={`v2-inf-tag ${KIND_CLASS[c.kind] ?? ''}`}>{c.kind}</span>
            </div>
            <div className="desc">{c.desc}</div>
          </div>
        ))}
      </div>

      {/* Run history */}
      <div className="v2-inf-sec">Recent runs</div>
      <div className="v2-card" style={{ overflow: 'hidden' }}>
        <table className="v2-table">
          <thead>
            <tr>
              <th>Run #</th>
              <th>Suite</th>
              <th>Result</th>
              <th>Duration</th>
              <th>Ran</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><span className="v2-inf-mono">#{r.id}</span></td>
                <td><span className="v2-inf-mono v2-inf-dim">{r.suite}</span></td>
                <td>
                  <span className={`v2-pill ${r.passed ? 'ok' : 'crit'}`}>
                    {r.passed ? 'Passed' : 'Failed'}
                  </span>
                </td>
                <td><span className="v2-inf-dim">{fmtDuration(r.duration_ms)}</span></td>
                <td><span className="v2-inf-dim">{rel(r.ran_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
