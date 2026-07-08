import '../components/infra.css';
import { requireSectionPage } from '@/lib/auth';
import { getScanRuns } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Operations · Infrastructure · Scans & checks. Renders inside the
// v2 shell (.v2-shell > .v2-content); this file provides page content only. The
// recent scan/worker run feed (getScanRuns() → ops.jobs, DB-first with a mock
// fallback). Shell classes from ../v2.css; page primitives from
// ../components/infra.css (namespaced v2-inf-).

// Map a job status to one of the shared pill tones.
function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (['complete', 'completed', 'succeeded', 'success', 'done', 'ok'].includes(s)) return 'ok';
  if (['failed', 'error', 'dead'].includes(s)) return 'crit';
  if (['running', 'active'].includes(s)) return 'info';
  if (['queued', 'pending', 'retry', 'waiting'].includes(s)) return 'high';
  return 'info';
}

export default async function V2ScansPage() {
  await requireSectionPage('operations');
  const { rows: runs, live } = await getScanRuns();

  return (
    <div>
      {/* Header */}
      <div className="v2-inf-head">
        <div>
          <div className="v2-eyebrow">Operations · Infrastructure</div>
          <div className="v2-inf-title">
            <h1 className="v2-h1">Scans &amp; checks</h1>
            <span className={`v2-inf-badge${live ? ' live' : ''}`}>
              <span className="dot" />
              {live ? 'Live · ops.jobs' : 'Mock'}
            </span>
          </div>
          <div className="v2-sub">
            {runs.length} recent runs · security + ops · scheduled and on-demand
          </div>
        </div>
      </div>

      {/* Recent runs table */}
      <div className="v2-card" style={{ overflow: 'hidden' }}>
        <table className="v2-table">
          <thead>
            <tr>
              <th>Run #</th>
              <th>Type</th>
              <th>Result</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><span className="v2-inf-mono">#{r.id}</span></td>
                <td><span className="v2-inf-name">{r.type}</span></td>
                <td><span className="v2-inf-dim">{r.findings}</span></td>
                <td><span className={`v2-pill ${statusPill(r.status)}`}>{r.status}</span></td>
                <td><span className="v2-inf-dim">{r.when}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
