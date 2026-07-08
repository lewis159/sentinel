import './testing.css';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Testing & quality gates. Renders inside the v2 shell
// (.v2-shell > .v2-content); this file provides page content only. This is the
// on-demand "Run checks" surface: the latest suite run for the pull request in
// review, and the gate decision that blocks promotion to production.
//
// All figures below are static/plausible fixtures — the live run feed will be
// wired to GET /api/v2/testing once the pipeline emits results. Styles come from
// ./testing.css (classes namespaced `v2-qg-`) using shell tokens from ../v2.css.

// ---- Inline icon set (16px, currentColor) -------------------------------------
function IconGate() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconBeaker() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v5.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 8.5V3" />
      <path d="M6.5 15h11" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconGauge() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 14 15 9" />
      <path d="M3.5 18a9 9 0 1 1 17 0" />
    </svg>
  );
}
function IconTrace() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5 15.4 17.5" />
      <path d="M15.4 6.5 8.6 10.5" />
    </svg>
  );
}
function IconRerun() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
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
          <div className="v2-sub">
            scribuo-web #482 · staging · PR #211 &lsquo;rebrand nav&rsquo; · ran 2m ago
          </div>
        </div>
        <div className="actions">
          <button type="button" className="v2-btn ghost">
            <IconRerun /> Re-run failing
          </button>
          <button type="button" className="v2-btn ghost">Report</button>
        </div>
      </div>

      {/* ---------- Gate banner ---------- */}
      <div className="v2-qg-gate">
        <span className="ic"><IconGate /></span>
        <span className="msg">
          <b>1 gate failing</b> — promote to production blocked
        </span>
        <span className="v2-pill crit">Blocked</span>
      </div>

      {/* ---------- Suite grid ---------- */}
      <div className="v2-qg-grid">
        {/* E2E · Playwright — failing */}
        <div className="v2-qg-suite s-crit">
          <div className="top">
            <span className="ic"><IconPlay /></span>
            <span className="nm">
              <b>E2E · Playwright</b>
              <small>chromium · 49 specs</small>
            </span>
            <span className="v2-pill crit">Fail</span>
          </div>
          <div className="v2-qg-stats">
            <div className="v2-qg-stat"><span className="n ok">46</span><span className="l">Passed</span></div>
            <div className="v2-qg-stat"><span className="n crit">2</span><span className="l">Failed</span></div>
            <div className="v2-qg-stat"><span className="n high">1</span><span className="l">Flaky</span></div>
            <div className="v2-qg-stat"><span className="n">3m12s</span><span className="l">Duration</span></div>
          </div>
        </div>

        {/* Security · DAST — warn */}
        <div className="v2-qg-suite s-high">
          <div className="top">
            <span className="ic"><IconShield /></span>
            <span className="nm">
              <b>Security · DAST</b>
              <small>ZAP baseline · staging</small>
            </span>
            <span className="v2-pill high">Warn</span>
          </div>
          <div className="v2-qg-stats">
            <div className="v2-qg-stat"><span className="n high">1</span><span className="l">High</span></div>
            <div className="v2-qg-stat"><span className="n">2</span><span className="l">Medium</span></div>
            <div className="v2-qg-stat"><span className="n">60%</span><span className="l">Headers</span></div>
            <div className="v2-qg-stat"><a className="l" href="/v2/security">→ Security</a></div>
          </div>
        </div>

        {/* Links & buttons — warn */}
        <div className="v2-qg-suite s-high">
          <div className="top">
            <span className="ic"><IconLink /></span>
            <span className="nm">
              <b>Links &amp; buttons</b>
              <small>crawl · 38 pages</small>
            </span>
            <span className="v2-pill high">Warn</span>
          </div>
          <div className="v2-qg-stats">
            <div className="v2-qg-stat"><span className="n">214</span><span className="l">Checked</span></div>
            <div className="v2-qg-stat"><span className="n high">2</span><span className="l">Broken</span></div>
          </div>
        </div>

        {/* Unit / integration — pass */}
        <div className="v2-qg-suite s-ok">
          <div className="top">
            <span className="ic"><IconBeaker /></span>
            <span className="nm">
              <b>Unit / integration</b>
              <small>Vitest · 3 shards</small>
            </span>
            <span className="v2-pill ok">Pass</span>
          </div>
          <div className="v2-qg-stats">
            <div className="v2-qg-stat"><span className="n ok">612</span><span className="l">Passed</span></div>
            <div className="v2-qg-stat"><span className="n">100%</span><span className="l">Suites</span></div>
            <div className="v2-qg-stat"><span className="n">41s</span><span className="l">Duration</span></div>
          </div>
        </div>

        {/* Accessibility · axe — pass */}
        <div className="v2-qg-suite s-ok">
          <div className="top">
            <span className="ic"><IconEye /></span>
            <span className="nm">
              <b>Accessibility · axe</b>
              <small>WCAG 2.1 AA · 38 pages</small>
            </span>
            <span className="v2-pill ok">Pass</span>
          </div>
          <div className="v2-qg-stats">
            <div className="v2-qg-stat"><span className="n ok">0</span><span className="l">Violations</span></div>
          </div>
        </div>

        {/* Lighthouse — pass (single score) */}
        <div className="v2-qg-suite s-ok">
          <div className="top">
            <span className="ic"><IconGauge /></span>
            <span className="nm">
              <b>Lighthouse</b>
              <small>mobile · performance</small>
            </span>
            <span className="v2-pill ok">Pass</span>
          </div>
          <div className="v2-qg-score">
            <span className="big">92</span>
            <span className="of">/ 100</span>
          </div>
        </div>
      </div>

      {/* ---------- Failing — needs action ---------- */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Failing — needs action</h3>
          <span className="v2-link">View full run</span>
        </div>

        {/* Failing E2E #1 */}
        <div className="v2-qg-fail f-crit">
          <span className="sev" />
          <span className="v2-qg-tag e2e">E2E</span>
          <div className="body">
            <div className="t">checkout completes with saved card</div>
            <div className="m">
              <span>e2e/checkout.spec.ts:142</span>
              <span>timeout waiting for #pay-confirm</span>
            </div>
          </div>
          <div className="v2-qg-chips">
            <button type="button" className="v2-qg-chip"><IconTrace /> Trace</button>
            <button type="button" className="v2-qg-chip"><IconRerun /> Re-run</button>
          </div>
        </div>

        {/* Failing E2E #2 */}
        <div className="v2-qg-fail f-crit">
          <span className="sev" />
          <span className="v2-qg-tag e2e">E2E</span>
          <div className="body">
            <div className="t">rebranded nav routes resolve</div>
            <div className="m">
              <span>e2e/nav.spec.ts:88</span>
              <span>expected 200, received 404 for /pricing</span>
            </div>
          </div>
          <div className="v2-qg-chips">
            <button type="button" className="v2-qg-chip"><IconTrace /> Trace</button>
            <button type="button" className="v2-qg-chip"><IconRerun /> Re-run</button>
          </div>
        </div>

        {/* DAST XSS finding */}
        <div className="v2-qg-fail f-high">
          <span className="sev" />
          <span className="v2-qg-tag dast">DAST</span>
          <div className="body">
            <div className="t">Reflected XSS in search query param</div>
            <div className="m">
              <span>GET /search?q= · unescaped reflection</span>
              <a href="/v2/security">→ SEC-052</a>
            </div>
          </div>
          <div className="v2-qg-chips">
            <a href="/v2/security" className="v2-qg-chip"><IconArrow /> Open finding</a>
          </div>
        </div>

        {/* Broken link #1 */}
        <div className="v2-qg-fail f-high">
          <span className="sev" />
          <span className="v2-qg-tag link">LINK</span>
          <div className="body">
            <div className="t">Footer &lsquo;Careers&rsquo; link 404s</div>
            <div className="m">
              <span>/careers → 404</span>
              <span>found on 38 pages (footer)</span>
            </div>
          </div>
          <div className="v2-qg-chips">
            <button type="button" className="v2-qg-chip"><IconArrow /> Locate</button>
          </div>
        </div>

        {/* Broken link #2 */}
        <div className="v2-qg-fail f-high">
          <span className="sev" />
          <span className="v2-qg-tag link">LINK</span>
          <div className="body">
            <div className="t">Pricing CTA button points at old host</div>
            <div className="m">
              <span>https://app.scribuo.io/checkout → DNS error</span>
              <span>components/PricingCta.tsx:24</span>
            </div>
          </div>
          <div className="v2-qg-chips">
            <button type="button" className="v2-qg-chip"><IconArrow /> Locate</button>
          </div>
        </div>
      </div>
    </div>
  );
}
