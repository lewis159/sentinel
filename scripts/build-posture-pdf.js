/*
 * build-posture-pdf.js — Branded Security Posture Report generator (LIVE data).
 *
 * WHAT IT DOES
 *   Connects to Sentinel's OWN local Postgres via `pg` and pulls LIVE posture data:
 *     - findings grouped by severity + status (ops.findings)
 *     - the open critical/high findings list (ops.findings)
 *     - tickets grouped by status (ops.tickets)
 *     - the latest resilience self-test run (ops.resilience_runs)
 *     - a recent container-snapshot count (ops.container_snapshots)
 *   It computes a simple weighted "security score" from the severity mix, then
 *   assembles ONE self-contained, print-optimised HTML document with a navy brand
 *   cover (Sentinel logo embedded base64, title "Security Posture Report", date,
 *   "Confidential" badge), a summary/KPI block, a findings-by-severity table, the
 *   open critical/high findings table, ticket status, and the latest resilience
 *   result. It writes that HTML to a temp path and prints the exact Chrome command
 *   to turn it into documents/Sentinel_Posture_Report.pdf.
 *
 * TWO-STEP PIPELINE (this script cannot run Chrome itself)
 *   1) Build the HTML (queries the live DB):
 *        node scripts/build-posture-pdf.js
 *      -> writes C:/Users/Ben/AppData/Local/Temp/secmock/posture.html
 *      -> prints the Chrome command to run.
 *   2) Render the PDF with headless Chrome (the orchestrator runs this):
 *        chrome --headless=new --no-pdf-header-footer \
 *               --print-to-pdf="C:/dev/sentinel/code/documents/Sentinel_Posture_Report.pdf" \
 *               "file:///C:/Users/Ben/AppData/Local/Temp/secmock/posture.html"
 *
 * CONFIG
 *   DATABASE_URL  Postgres connection string.
 *                 Default: postgres://sentinel:sentinel@localhost:5434/sentinel
 *   PGSSL=disable to skip TLS (plain local Postgres). Otherwise SSL is used with
 *                 rejectUnauthorized:false (Patroni/Spilo self-signed cert).
 *
 * DEPENDENCIES: only `pg` + Node builtins. No TypeScript, no Chrome at build time.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ---------------------------------------------------------------------------
// Paths & configuration
// ---------------------------------------------------------------------------
const CODE_ROOT = path.resolve(__dirname, '..'); // C:/dev/sentinel/code
const OUT_HTML = 'C:/Users/Ben/AppData/Local/Temp/secmock/posture.html';
const OUT_PDF = path.join(CODE_ROOT, 'documents', 'Sentinel_Posture_Report.pdf');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://sentinel:sentinel@localhost:5434/sentinel';
const SSL = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

// Brand assets (white lockup for the dark cover).
const BRAND_LOGO_LIGHT =
  'Z:/GIT/Cursor/new project/sentinel/documents/brand/logo/sentinel-logo-light.png';

// Brand palette (Sentinel = blue).
const BRAND = {
  primary: '#2D6CFF',
  deep: '#1B4DD1',
  navy: '#0B1B3B',
  bannerFrom: '#0B1424',
  bannerTo: '#14233F',
};

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_LABEL = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
};
// Per-open-finding penalty used for the weighted security score.
const SEV_WEIGHT = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tryDataUri(absPath) {
  try {
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      const b64 = fs.readFileSync(absPath).toString('base64');
      return `data:${mime};base64,${b64}`;
    }
  } catch (_) {
    /* treated as missing */
  }
  return null;
}

function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

// ---------------------------------------------------------------------------
// Live data access — every query is wrapped so a missing table never aborts the
// whole report (the section just renders empty / "no data").
// ---------------------------------------------------------------------------
async function safe(client, text, params, fallback) {
  try {
    const res = await client.query(text, params);
    return res.rows;
  } catch (e) {
    console.warn(`[posture-pdf] query failed (${e.code || e.message}); using fallback`);
    return fallback;
  }
}

async function loadData(client) {
  // findings grouped by severity + status
  const sevStatus = await safe(
    client,
    'select severity, status, count(*)::int as n from ops.findings group by severity, status',
    [],
    []
  );

  // open critical/high findings list
  const openCritHigh = await safe(
    client,
    `select ref, title, severity, cvss, component_label, status
       from ops.findings
      where severity in ('critical','high') and status <> 'fixed'
      order by cvss desc nulls last`,
    [],
    []
  );

  // tickets by status
  const ticketStatus = await safe(
    client,
    'select status, count(*)::int as n from ops.tickets group by status',
    [],
    []
  );

  // latest resilience run
  const resRows = await safe(
    client,
    'select id, suite, passed, results, duration_ms, ran_at from ops.resilience_runs order by ran_at desc limit 1',
    [],
    []
  );

  // recent container snapshots count (last 24h)
  const snapRows = await safe(
    client,
    "select count(*)::int as n from ops.container_snapshots where captured_at > now() - interval '24 hours'",
    [],
    [{ n: 0 }]
  );

  return { sevStatus, openCritHigh, ticketStatus, resRows, snapRows };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------
function deriveSummary(data) {
  // Build a severity x {open,total} grid from the grouped rows.
  const grid = {};
  for (const s of SEVERITIES) grid[s] = { open: 0, total: 0 };
  for (const r of data.sevStatus) {
    const sev = SEVERITIES.includes(r.severity) ? r.severity : 'medium';
    const n = Number(r.n) || 0;
    grid[sev].total += n;
    if (r.status !== 'fixed') grid[sev].open += n;
  }

  const totalFindings = SEVERITIES.reduce((a, s) => a + grid[s].total, 0);
  const openFindings = SEVERITIES.reduce((a, s) => a + grid[s].open, 0);

  // Weighted security score: start at 100, subtract per open finding by severity,
  // clamped to [0,100]. Simple + explainable for a stakeholder report.
  const penalty = SEVERITIES.reduce((a, s) => a + grid[s].open * SEV_WEIGHT[s], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  // Tickets
  const ticketGrid = {};
  let openTickets = 0;
  let totalTickets = 0;
  for (const r of data.ticketStatus) {
    const n = Number(r.n) || 0;
    ticketGrid[r.status] = (ticketGrid[r.status] || 0) + n;
    totalTickets += n;
    if (r.status !== 'resolved' && r.status !== 'closed' && r.status !== 'fixed') openTickets += n;
  }

  // Latest resilience run
  let resilience = null;
  if (data.resRows && data.resRows[0]) {
    const r = data.resRows[0];
    const results = typeof r.results === 'string' ? safeJson(r.results) : r.results || {};
    resilience = {
      id: r.id,
      suite: r.suite,
      passed: Boolean(r.passed),
      results,
      duration_ms: Number(r.duration_ms) || 0,
      ran_at: r.ran_at instanceof Date ? r.ran_at.toISOString() : r.ran_at,
    };
  }

  const snapshots = (data.snapRows && data.snapRows[0] && Number(data.snapRows[0].n)) || 0;

  return {
    grid, totalFindings, openFindings, ticketGrid, openTickets, totalTickets,
    resilience, snapshots, score, openCritHigh: data.openCritHigh || [],
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function scoreBand(score) {
  if (score >= 85) return { label: 'Strong', color: '#2BA86B' };
  if (score >= 65) return { label: 'Moderate', color: '#1B4DD1' };
  if (score >= 40) return { label: 'At risk', color: '#C9821B' };
  return { label: 'Critical', color: '#C0392B' };
}

// ---------------------------------------------------------------------------
// CSS — print-optimised, branded.
// ---------------------------------------------------------------------------
function buildCss() {
  return `
  :root{
    --brand-primary:${BRAND.primary};
    --brand-deep:${BRAND.deep};
    --brand-navy:${BRAND.navy};
    --banner-from:${BRAND.bannerFrom};
    --banner-to:${BRAND.bannerTo};
    --ink:#1a2233;
    --muted:#5b6b86;
    --line:#d8e0ee;
    --light-blue:#eaf1ff;
    --crit:#C0392B; --high:#C9821B; --med:#B7950B; --low:#1B4DD1; --info:#5b6b86;
  }
  @page{ size:A4; margin:18mm 16mm; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); font-size:10.5pt; line-height:1.55;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }

  /* ---- Cover ---- */
  .cover{
    position:relative; height:265mm; margin:-18mm -16mm 0 -16mm; padding:34mm 24mm;
    background:linear-gradient(150deg,var(--banner-from) 0%,var(--banner-to) 100%);
    color:#fff; page-break-after:always; display:flex; flex-direction:column;
  }
  .cover__logo{ height:46px; width:auto; align-self:flex-start; margin-bottom:auto; }
  .cover__logo-fallback{ font-size:26pt; font-weight:800; letter-spacing:.5px; color:#fff; align-self:flex-start; margin-bottom:auto; }
  .cover__rule{ width:96px; height:5px; border-radius:3px; background:var(--brand-primary); margin:0 0 22px; }
  .cover__title{ font-size:42pt; font-weight:800; line-height:1.05; margin:0 0 8px; }
  .cover__subtitle{ font-size:16pt; font-weight:500; color:#b9c8e8; margin:0 0 26px; }
  .cover__meta{ font-size:11pt; color:#9fb2d8; }
  .cover__badge{
    display:inline-block; margin-top:18px; padding:7px 16px; border-radius:999px;
    background:rgba(45,108,255,.18); border:1px solid rgba(45,108,255,.55);
    color:#cfe0ff; font-size:9.5pt; font-weight:600; letter-spacing:.4px; text-transform:uppercase;
  }

  /* ---- Section ---- */
  .section{ page-break-before:always; }
  .section:first-of-type{ page-break-before:avoid; }
  .kicker{
    display:inline-block; font-size:8.5pt; font-weight:700; letter-spacing:1px;
    text-transform:uppercase; color:var(--brand-primary);
    border:1px solid var(--light-blue); background:var(--light-blue);
    padding:3px 10px; border-radius:6px; margin-bottom:6px;
  }

  h1{ color:var(--brand-navy); font-size:24pt; margin:.1em 0 .35em; line-height:1.15;
      border-bottom:3px solid var(--brand-primary); padding-bottom:.18em; }
  h2{ color:var(--brand-deep); font-size:16pt; margin:1.1em 0 .35em; }
  h3{ color:var(--brand-primary); font-size:12.5pt; margin:1em 0 .3em; }
  p{ margin:.45em 0; }
  strong{ color:var(--brand-navy); }

  /* ---- Score + KPI block ---- */
  .scorewrap{ display:flex; gap:18px; align-items:stretch; margin:14px 0 6px; }
  .scorebox{ flex:0 0 150px; border:1px solid var(--line); border-radius:12px; padding:16px;
             text-align:center; background:var(--light-blue); }
  .scorebox .num{ font-size:40pt; font-weight:800; line-height:1; }
  .scorebox .den{ color:var(--muted); font-size:11pt; }
  .scorebox .band{ margin-top:8px; font-weight:700; font-size:10pt; }
  .kpis{ flex:1; display:flex; flex-wrap:wrap; gap:10px; }
  .kpi{ flex:1 1 120px; border:1px solid var(--line); border-radius:10px; padding:11px 13px; background:#fff; }
  .kpi .k{ color:var(--muted); font-size:8.5pt; text-transform:uppercase; letter-spacing:.6px; font-weight:700; }
  .kpi .v{ font-size:18pt; font-weight:800; margin-top:3px; }

  /* ---- Tables ---- */
  table{ border-collapse:collapse; width:100%; margin:.8em 0; font-size:9.5pt; page-break-inside:auto; }
  th,td{ border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top; }
  thead th{ background:var(--light-blue); color:var(--brand-deep); font-weight:700;
            border-bottom:2px solid var(--brand-primary); }
  tbody tr:nth-child(even){ background:#f6f9ff; }
  td.num, th.num{ text-align:right; font-variant-numeric:tabular-nums; }

  .sevdot{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; }
  .sev-critical .sevdot{ background:var(--crit); } .sev-high .sevdot{ background:var(--high); }
  .sev-medium .sevdot{ background:var(--med); } .sev-low .sevdot{ background:var(--low); }
  .sev-info .sevdot{ background:var(--info); }

  .pass{ color:#2BA86B; font-weight:700; } .fail{ color:#C0392B; font-weight:700; }
  .muted{ color:var(--muted); }
  .empty{ color:var(--muted); font-style:italic; padding:8px 0; }
  `;
}

// ---------------------------------------------------------------------------
// HTML section builders
// ---------------------------------------------------------------------------
function buildCover(logoUri, dateStr) {
  const logo = logoUri
    ? `<img class="cover__logo" src="${logoUri}" alt="Sentinel" />`
    : `<div class="cover__logo-fallback">SENTINEL</div>`;
  return (
    `<div class="cover">` +
    logo +
    `<div class="cover__rule"></div>` +
    `<h1 class="cover__title">Security Posture Report</h1>` +
    `<p class="cover__subtitle">Operations &amp; Security Console</p>` +
    `<div class="cover__meta">Generated ${htmlEscape(dateStr)} · LIVE data</div>` +
    `<div><span class="cover__badge">Confidential · Internal</span></div>` +
    `</div>`
  );
}

function buildSummary(sum) {
  const band = scoreBand(sum.score);
  const res = sum.resilience;
  const resKpi = res
    ? `<span class="${res.passed ? 'pass' : 'fail'}">${res.passed ? 'Pass' : 'Fail'}</span>`
    : '<span class="muted">—</span>';
  return (
    `<section class="section">` +
    `<span class="kicker">Summary</span>` +
    `<h1>Posture summary</h1>` +
    `<div class="scorewrap">` +
      `<div class="scorebox">` +
        `<div class="num" style="color:${band.color}">${sum.score}</div>` +
        `<div class="den">/ 100</div>` +
        `<div class="band" style="color:${band.color}">${band.label}</div>` +
      `</div>` +
      `<div class="kpis">` +
        kpi('Open findings', sum.openFindings) +
        kpi('Critical (open)', sum.grid.critical.open) +
        kpi('High (open)', sum.grid.high.open) +
        kpi('Open tickets', sum.openTickets) +
        kpi('Snapshots (24h)', sum.snapshots) +
        kpi('Last resilience', resKpi) +
      `</div>` +
    `</div>` +
    `<p class="muted">The security score starts at 100 and deducts a weighted penalty per ` +
    `open finding (critical −25, high −12, medium −5, low −2), clamped to 0–100.</p>` +
    `</section>`
  );
}

function kpi(k, v) {
  return `<div class="kpi"><div class="k">${htmlEscape(k)}</div><div class="v">${v}</div></div>`;
}

function buildSeverityTable(sum) {
  const rows = SEVERITIES.map((s) => {
    const g = sum.grid[s];
    return (
      `<tr class="sev-${s}">` +
      `<td><span class="sevdot"></span>${SEV_LABEL[s]}</td>` +
      `<td class="num">${g.open}</td>` +
      `<td class="num">${g.total - g.open}</td>` +
      `<td class="num">${g.total}</td>` +
      `</tr>`
    );
  }).join('');
  return (
    `<section class="section">` +
    `<span class="kicker">Findings</span>` +
    `<h1>Findings by severity</h1>` +
    `<table><thead><tr><th>Severity</th><th class="num">Open</th>` +
    `<th class="num">Fixed</th><th class="num">Total</th></tr></thead>` +
    `<tbody>${rows}` +
    `<tr><td><strong>All</strong></td>` +
    `<td class="num"><strong>${sum.openFindings}</strong></td>` +
    `<td class="num"><strong>${sum.totalFindings - sum.openFindings}</strong></td>` +
    `<td class="num"><strong>${sum.totalFindings}</strong></td></tr>` +
    `</tbody></table>` +
    `</section>`
  );
}

function buildOpenList(openCritHigh) {
  let body;
  if (!openCritHigh.length) {
    body = `<p class="empty">No open critical or high findings — clean.</p>`;
  } else {
    const rows = openCritHigh.map((f) => {
      const sev = SEVERITIES.includes(f.severity) ? f.severity : 'medium';
      return (
        `<tr class="sev-${sev}">` +
        `<td>${htmlEscape(f.ref)}</td>` +
        `<td><span class="sevdot"></span>${SEV_LABEL[sev]}</td>` +
        `<td>${htmlEscape(f.title)}</td>` +
        `<td>${htmlEscape(f.component_label || '—')}</td>` +
        `<td class="num">${f.cvss != null ? htmlEscape(f.cvss) : '—'}</td>` +
        `<td>${htmlEscape(f.status)}</td>` +
        `</tr>`
      );
    }).join('');
    body =
      `<table><thead><tr><th>Ref</th><th>Severity</th><th>Finding</th>` +
      `<th>Component</th><th class="num">CVSS</th><th>Status</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }
  return (
    `<section class="section">` +
    `<span class="kicker">Priorities</span>` +
    `<h1>Open critical &amp; high findings</h1>` +
    body +
    `</section>`
  );
}

function buildTickets(sum) {
  const statuses = Object.keys(sum.ticketGrid);
  let body;
  if (!statuses.length) {
    body = `<p class="empty">No tickets recorded.</p>`;
  } else {
    const rows = statuses
      .sort()
      .map((s) => `<tr><td>${htmlEscape(s)}</td><td class="num">${sum.ticketGrid[s]}</td></tr>`)
      .join('');
    body =
      `<table><thead><tr><th>Status</th><th class="num">Tickets</th></tr></thead>` +
      `<tbody>${rows}` +
      `<tr><td><strong>Total</strong></td><td class="num"><strong>${sum.totalTickets}</strong></td></tr>` +
      `</tbody></table>`;
  }
  return (
    `<section class="section">` +
    `<span class="kicker">Remediation</span>` +
    `<h1>Ticket status</h1>` +
    body +
    `</section>`
  );
}

function buildResilience(res) {
  let body;
  if (!res) {
    body = `<p class="empty">No resilience runs recorded.</p>`;
  } else {
    const checkRows = Object.entries(res.results || {})
      .map(([key, r]) =>
        `<tr><td>${htmlEscape(key)}</td>` +
        `<td class="${r.passed ? 'pass' : 'fail'}">${r.passed ? 'Pass' : 'Fail'}</td>` +
        `<td>${htmlEscape(r.detail || '')}</td></tr>`
      )
      .join('');
    body =
      `<p>Latest run <strong>#${htmlEscape(res.id)}</strong> · suite ` +
      `<strong>${htmlEscape(res.suite)}</strong> · ` +
      `<span class="${res.passed ? 'pass' : 'fail'}">${res.passed ? 'PASSED' : 'FAILED'}</span> · ` +
      `${fmtDuration(res.duration_ms)} · ` +
      `<span class="muted">${htmlEscape(res.ran_at)}</span></p>` +
      `<table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>` +
      `<tbody>${checkRows || '<tr><td colspan="3" class="empty">No per-check results.</td></tr>'}</tbody></table>`;
  }
  return (
    `<section class="section">` +
    `<span class="kicker">Resilience</span>` +
    `<h1>Latest resilience self-test</h1>` +
    body +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------
async function main() {
  const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);
  const logoUri = tryDataUri(BRAND_LOGO_LIGHT);

  const client = new Client({ connectionString: DATABASE_URL, ssl: SSL });
  console.log(`[posture-pdf] Connecting to ${DATABASE_URL.replace(/:[^:@/]*@/, ':****@')} …`);
  await client.connect();

  let sum;
  try {
    const data = await loadData(client);
    sum = deriveSummary(data);
  } finally {
    await client.end();
  }

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
    `<title>Sentinel Security Posture Report</title>` +
    `<style>${buildCss()}</style></head><body>` +
    buildCover(logoUri, dateStr) +
    buildSummary(sum) +
    buildSeverityTable(sum) +
    buildOpenList(sum.openCritHigh) +
    buildTickets(sum) +
    buildResilience(sum.resilience) +
    `</body></html>`;

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const htmlForUrl = OUT_HTML.replace(/\\/g, '/');
  const pdfForCmd = OUT_PDF.replace(/\\/g, '/');
  console.log(`[posture-pdf] Wrote HTML  -> ${OUT_HTML}`);
  console.log(`[posture-pdf] Score       : ${sum.score}/100`);
  console.log(`[posture-pdf] Findings    : ${sum.openFindings} open / ${sum.totalFindings} total`);
  console.log(`[posture-pdf] Tickets     : ${sum.openTickets} open / ${sum.totalTickets} total`);
  console.log(`[posture-pdf] Logo embed  : ${logoUri ? 'yes' : 'NO (text fallback)'}`);
  console.log('');
  console.log('Next step — render the PDF with headless Chrome:');
  console.log(
    `Run: chrome --headless=new --no-pdf-header-footer ` +
      `--print-to-pdf="${pdfForCmd}" "file:///${htmlForUrl}"`
  );
}

main().catch((err) => {
  console.error('[posture-pdf] FAILED:', err);
  process.exit(1);
});
