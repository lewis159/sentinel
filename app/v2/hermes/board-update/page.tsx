// Hermes · Board / Founder-Update prep.
//
// Assembles the current month's board/investor/founder update from READ-ONLY
// estate data: headline metrics (MRR / new revenue / churn / runway where
// derivable — else "no data" + a TODO for the real source), roadmap progress
// (shipped / in flight), support + ops health, and wins. Renders a structured
// markdown DRAFT the founder edits and sends by hand — there is NO auto-send.
//
// Admin-gated (same section as the Governance console) because it surfaces
// revenue. Dormant-safe: with no DB it renders on mock data.
import { requireSectionPage } from '@/lib/auth';
import { assembleBoardUpdate } from '@/lib/board-update/assemble';
import { buildDraft } from '@/lib/board-update/draft';
import type { MetricValue } from '@/lib/board-update/assemble';
import BoardUpdateActions from '@/components/v2/board-update/BoardUpdateActions';
import './board-update.css';

export const dynamic = 'force-dynamic';

function Metric({ label, m }: { label: string; m: MetricValue }) {
  return (
    <div className={`v2-bu-metric${m.available ? '' : ' v2-bu-metric-nd'}`}>
      <div className="v2-bu-metric-label">{label}</div>
      <div className="v2-bu-metric-val">{m.available ? m.display : 'No data'}</div>
      <div className="v2-bu-metric-src">{m.available ? m.source : m.todo ?? 'source not wired'}</div>
    </div>
  );
}

export default async function BoardUpdatePage() {
  await requireSectionPage('admin');

  const update = await assembleBoardUpdate();
  const draft = await buildDraft(update);

  return (
    <div>
      {/* Header */}
      <div className="v2-bu-head">
        <div>
          <div className="v2-eyebrow">Hermes · Board update</div>
          <h1 className="v2-h1">Board / founder update — {update.period}</h1>
          <div className="v2-sub">
            Assembled from read-only estate data. Missing sources show as “no data”, never a guess.
            This is a <strong>draft</strong> — review, edit and send it yourself. Nothing is sent automatically.
            {draft.mode === 'llm' && draft.model ? ` Narrative by ${draft.model}.` : ''}
          </div>
        </div>
      </div>

      {/* Metric strip */}
      <div className="v2-bu-strip">
        <Metric label="MRR" m={update.metrics.mrr} />
        <Metric label="New revenue" m={update.metrics.newRevenue} />
        <Metric label="Churn" m={update.metrics.churn} />
        <Metric label="Runway" m={update.metrics.runway} />
      </div>

      <div className="v2-bu-cols">
        {/* Roadmap */}
        <div className="v2-card v2-bu-card">
          <div className="v2-card-h"><h3>Roadmap</h3></div>
          <div className="v2-bu-body">
            <div className="v2-bu-colh">Shipped ({update.roadmap.shipped.length})</div>
            {update.roadmap.shipped.length > 0 ? (
              <ul className="v2-bu-list">
                {update.roadmap.shipped.map((s) => (
                  <li key={s.key}>{s.title} <span className="v2-bu-tag">{s.app}</span></li>
                ))}
              </ul>
            ) : (
              <div className="v2-bu-empty">{update.roadmap.hasData ? 'Nothing shipped this period.' : 'No data'}</div>
            )}

            <div className="v2-bu-colh">In flight ({update.roadmap.inFlight.length})</div>
            {update.roadmap.inFlight.length > 0 ? (
              <ul className="v2-bu-list">
                {update.roadmap.inFlight.map((s) => (
                  <li key={s.key}>{s.title} <span className="v2-bu-tag">{s.status.replace('_', ' ')}</span></li>
                ))}
              </ul>
            ) : (
              <div className="v2-bu-empty">{update.roadmap.hasData ? 'Nothing in flight.' : 'No data'}</div>
            )}
          </div>
        </div>

        {/* Support + ops */}
        <div className="v2-card v2-bu-card">
          <div className="v2-card-h"><h3>Support &amp; ops health</h3></div>
          <div className="v2-bu-body">
            {update.support.hasData ? (
              <ul className="v2-bu-kv">
                <li><span>Ticket volume</span><b>{update.support.ticketVolume}</b></li>
                <li><span>Resolved</span><b>{update.support.resolved}</b></li>
                <li><span>Open</span><b>{update.support.open}</b></li>
                <li><span>SLA breaches</span><b>{update.support.slaBreaches}</b></li>
              </ul>
            ) : (
              <div className="v2-bu-empty">Support: no data</div>
            )}
            {update.ops.hasData ? (
              <ul className="v2-bu-kv">
                <li><span>Incidents</span><b>{update.ops.incidents}</b></li>
                <li><span>Incidents resolved</span><b>{update.ops.incidentsResolved}</b></li>
                <li><span>Uptime</span><b>{update.ops.uptime.available ? update.ops.uptime.display : 'no data'}</b></li>
              </ul>
            ) : (
              <div className="v2-bu-empty">Ops: no data</div>
            )}
          </div>
        </div>

        {/* Wins */}
        <div className="v2-card v2-bu-card">
          <div className="v2-card-h"><h3>Wins</h3></div>
          <div className="v2-bu-body">
            {update.wins.items.length > 0 ? (
              <ul className="v2-bu-list">
                {update.wins.items.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            ) : (
              <div className="v2-bu-empty">No wins derivable this period.</div>
            )}
          </div>
        </div>
      </div>

      {/* Draft */}
      <div className="v2-card v2-bu-card">
        <div className="v2-card-h">
          <h3>Draft update</h3>
          <span className="v2-bu-mode">{draft.mode === 'llm' ? 'AI narrative' : 'Deterministic template'}</span>
        </div>
        <div className="v2-bu-body">
          <BoardUpdateActions markdown={draft.markdown} />
          <pre className="v2-bu-draft">{draft.markdown}</pre>
        </div>
      </div>
    </div>
  );
}
