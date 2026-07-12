import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { assembleHealthDigest } from '@/lib/health/digest';
import { BAND_LABEL, type HealthBand } from '@/lib/health/score';
import HealthTable from './HealthTable';
import './health.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Customer-Health Digest — the per-customer health picture for the whole
// portfolio: who's thriving, who's at risk, where the upsell is. READ-ONLY. Feeds
// churn-save (the Hermes floor) and upsell surfaces via links; takes no actions.
// Backed by real ops data (getCustomer360-style reads) with a mock fallback.
// ---------------------------------------------------------------------------

// Band → tile tint (reuses the existing v2 tile variants).
const BAND_TILE: Record<HealthBand, string> = {
  thriving: 't-ok',
  healthy: 't-sky',
  'at-risk': 't-high',
  critical: 't-crit',
};

const BAND_ORDER: HealthBand[] = ['thriving', 'healthy', 'at-risk', 'critical'];

export default async function HealthDigestPage() {
  await requireSectionPage('hermes');

  const digest = await assembleHealthDigest();
  const { bandCounts } = digest;
  const atRiskCount = bandCounts['at-risk'] + bandCounts.critical;

  return (
    <div className="v2-hd-page">
      {/* ---------- Header ---------- */}
      <div className="v2-hd-head">
        <div>
          <div className="v2-eyebrow">Hermes · Customer success</div>
          <div className="v2-hd-title">
            <h1 className="v2-h1">Customer-health digest</h1>
            <span className={`v2-hd-badge${digest.live ? ' live' : ''}`}>
              <span className="dot" aria-hidden />
              {digest.live ? 'Live' : 'Mock'}
            </span>
          </div>
          <div className="v2-sub">
            {digest.totals.customers} customers scored · {atRiskCount} need attention ·{' '}
            {digest.upsellCandidates.length} upsell candidate
            {digest.upsellCandidates.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* ---------- Portfolio band strip ---------- */}
      <div className="v2-hd-strip">
        {BAND_ORDER.map((band) => (
          <div className={`v2-tile ${BAND_TILE[band]}`} key={band}>
            <div className="k">{BAND_LABEL[band]}</div>
            <div className="v">{bandCounts[band]}</div>
            <div className="meta">
              {digest.totals.customers > 0
                ? `${Math.round((bandCounts[band] / digest.totals.customers) * 100)}% of portfolio`
                : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Optional AI narrative ---------- */}
      {digest.narrative ? (
        <div className="v2-card v2-hd-narrative">
          <div className="v2-card-h">
            <h3>Weekly summary</h3>
            <span className="v2-hd-ai-tag">AI · advisory</span>
          </div>
          <p>{digest.narrative}</p>
        </div>
      ) : (
        <div className="v2-hd-narrative-off">
          {digest.narrativeSource === 'disabled'
            ? 'AI narrative off — enable HERMES_BRAIN_ENABLED for a weekly written summary. Scores below are deterministic and need no AI.'
            : 'AI narrative unavailable right now — scores below are deterministic and unaffected.'}
        </div>
      )}

      {/* ---------- Context row: churn signal + upsell ---------- */}
      <div className="v2-hd-context">
        <div className="v2-card v2-hd-ctx">
          <div className="v2-card-h">
            <h3>Churn signal</h3>
            <Link href="/v2/hermes/floor" className="v2-link">
              Churn-save floor
            </Link>
          </div>
          <p className="v2-hd-ctx-body">
            {digest.churn.configured
              ? `${digest.churn.failedInvoices} failed payment(s) in the last ${digest.churn.windowHours}h (threshold ${digest.churn.threshold}).`
              : 'Failed-payment signal not configured (no billing source wired). Portfolio-level only — not yet attributable per customer.'}
          </p>
        </div>
        <div className="v2-card v2-hd-ctx">
          <div className="v2-card-h">
            <h3>Upsell candidates</h3>
            <span className="v2-hd-ctx-count">{digest.upsellCandidates.length}</span>
          </div>
          {digest.upsellCandidates.length === 0 ? (
            <p className="v2-hd-ctx-body">No upsell candidates right now.</p>
          ) : (
            <ul className="v2-hd-upsell-list">
              {digest.upsellCandidates.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/v2/support/customers/${encodeURIComponent(c.id)}`} className="v2-link">
                    {c.name}
                  </Link>
                  <span className="reason">{c.upsell?.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- Customer table ---------- */}
      <div className="v2-card v2-hd-table-card">
        <div className="v2-card-h">
          <h3>Customers by health</h3>
          <span className="v2-hd-hint">Click a column to sort · worst-first by default</span>
        </div>
        <div className="v2-hd-table-wrap">
          <HealthTable customers={digest.customers} />
        </div>
      </div>
    </div>
  );
}
