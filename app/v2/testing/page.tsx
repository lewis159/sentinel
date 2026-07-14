import './testing.css';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Testing & quality gates. Renders inside the v2 shell
// (.v2-shell > .v2-content); this file provides page content only. This is the
// on-demand "Run checks" surface: the latest suite run for the pull request in
// review, and the gate decision that blocks promotion to production.
//
// The CI/quality-gate pipeline does not yet emit results into Sentinel, so the
// fabricated suite fixtures (Playwright/DAST/Vitest/Lighthouse counts, failing
// specs, gate banner) have been removed rather than shown as if they were a real
// run. An honest empty state renders until GET /api/v2/testing is wired to the
// pipeline. Styles come from ./testing.css (classes namespaced `v2-qg-`).

function IconGate() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

export default async function V2TestingPage() {
  await requireSectionPage('operations');

  return (
    <div className="v2-qg">
      {/* ---------- Header ---------- */}
      <div className="v2-qg-head">
        <div>
          <div className="v2-eyebrow">Operations · Delivery</div>
          <h1 className="v2-h1">Testing &amp; quality gates</h1>
          <div className="v2-sub">Suite results and the gate decision that blocks promotion to production</div>
        </div>
      </div>

      {/* ---------- Empty state — no pipeline feed yet ---------- */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Latest run</h3>
          <span className="v2-pill info">No feed</span>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '28px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          <span style={{ width: 20, height: 20, flex: '0 0 auto', color: 'var(--muted)' }}><IconGate /></span>
          <span>
            No test runs have been reported yet. When the CI pipeline (Playwright E2E,
            DAST, unit/integration, accessibility, Lighthouse) posts results to
            Sentinel, the latest suite run and the promote-to-production gate decision
            will appear here. No pass/fail figures are shown until a real run arrives.
          </span>
        </div>
      </div>
    </div>
  );
}
