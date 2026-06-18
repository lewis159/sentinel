/*
 * build-business-plan-pdf.js — Branded Sentinel Business Plan PDF generator.
 *
 * WHAT IT DOES
 *   Reads the business-plan markdown, converts it to HTML with `marked`, wraps it
 *   in the Sentinel blue brand (navy cover with embedded logo + "Confidential"
 *   badge, an auto-generated Table of Contents from the H1/H2 headings, and the
 *   same print-optimised CSS as the posture/KB reports). Writes a self-contained
 *   HTML file and prints the headless-Chrome command to render the PDF.
 *
 * TWO-STEP PIPELINE (this script cannot run Chrome itself)
 *   1) node scripts/build-business-plan-pdf.js
 *   2) chrome --headless=new --no-pdf-header-footer \
 *        --print-to-pdf="<OUT_PDF>" "file:///<OUT_HTML>"
 *
 * DEPENDENCIES: `marked` (already used by the KB) + Node builtins. No Chrome at build.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// --- Paths ---------------------------------------------------------------
const DOCS_ROOT = 'Z:/GIT/Cursor/new project/sentinel/documents';
const SRC_MD = path.join(DOCS_ROOT, 'technical-design', 'SENTINEL_BUSINESS_PLAN.md');
const OUT_HTML = 'C:/Users/Ben/AppData/Local/Temp/secmock/business-plan.html';
const OUT_PDF = path.join(DOCS_ROOT, 'technical-design', 'Sentinel_Business_Plan.pdf');
const BRAND_LOGO_LIGHT = path.join(DOCS_ROOT, 'brand', 'logo', 'sentinel-logo-light.png');

const BRAND = {
  primary: '#2D6CFF', deep: '#1B4DD1', navy: '#0B1B3B',
  bannerFrom: '#0B1424', bannerTo: '#14233F',
};

// --- Helpers -------------------------------------------------------------
function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function tryDataUri(absPath) {
  try {
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
    }
  } catch (_) { /* missing */ }
  return null;
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}

// --- TOC: pull H1/H2 from the markdown, assign stable slugs ---------------
function extractToc(md) {
  const toc = [];
  const seen = {};
  // Ignore headings inside fenced code blocks.
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,2})\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const textRaw = m[2].replace(/[#*_`]/g, '').replace(/\\/g, '').trim();
    if (!textRaw) continue;
    let slug = slugify(textRaw);
    if (seen[slug] != null) { seen[slug] += 1; slug = `${slug}-${seen[slug]}`; } else seen[slug] = 0;
    toc.push({ level, text: textRaw, slug });
  }
  return toc;
}

// Renderer that gives headings the SAME slug ids the TOC links to.
function buildRenderer() {
  const seen = {};
  const renderer = new marked.Renderer();
  renderer.heading = function (text, level) {
    const plain = String(text).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').trim();
    let slug = slugify(plain);
    if (seen[slug] != null) { seen[slug] += 1; slug = `${slug}-${seen[slug]}`; } else seen[slug] = 0;
    const cls = level === 1 ? ' class="doc-h1"' : '';
    return `<h${level} id="${slug}"${cls}>${text}</h${level}>\n`;
  };
  return renderer;
}

function buildCss() {
  return `
  :root{
    --brand-primary:${BRAND.primary}; --brand-deep:${BRAND.deep}; --brand-navy:${BRAND.navy};
    --banner-from:${BRAND.bannerFrom}; --banner-to:${BRAND.bannerTo};
    --ink:#1a2233; --muted:#5b6b86; --line:#d8e0ee; --light-blue:#eaf1ff;
  }
  @page{ size:A4; margin:18mm 16mm; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); font-size:10.5pt; line-height:1.55;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  /* Cover */
  .cover{ position:relative; height:265mm; margin:-18mm -16mm 0 -16mm; padding:34mm 24mm;
    background:linear-gradient(150deg,var(--banner-from) 0%,var(--banner-to) 100%);
    color:#fff; page-break-after:always; display:flex; flex-direction:column; }
  .cover__logo{ height:46px; width:auto; align-self:flex-start; margin-bottom:auto; }
  .cover__logo-fallback{ font-size:26pt; font-weight:800; letter-spacing:.5px; color:#fff; align-self:flex-start; margin-bottom:auto; }
  .cover__rule{ width:96px; height:5px; border-radius:3px; background:var(--brand-primary); margin:0 0 22px; }
  .cover__title{ font-size:40pt; font-weight:800; line-height:1.06; margin:0 0 8px; }
  .cover__subtitle{ font-size:15pt; font-weight:500; color:#b9c8e8; margin:0 0 26px; }
  .cover__meta{ font-size:11pt; color:#9fb2d8; }
  .cover__badge{ display:inline-block; margin-top:18px; padding:7px 16px; border-radius:999px;
    background:rgba(45,108,255,.18); border:1px solid rgba(45,108,255,.55);
    color:#cfe0ff; font-size:9.5pt; font-weight:600; letter-spacing:.4px; text-transform:uppercase; }

  /* TOC */
  .toc{ page-break-after:always; }
  .toc h2{ color:var(--brand-navy); font-size:20pt; border-bottom:3px solid var(--brand-primary);
    padding-bottom:.18em; margin:.1em 0 .6em; }
  .toc ol{ list-style:none; padding:0; margin:0; counter-reset:toc; }
  .toc li{ padding:5px 0; border-bottom:1px dotted var(--line); }
  .toc li.lvl1{ font-weight:700; color:var(--brand-deep); }
  .toc li.lvl2{ padding-left:18px; font-size:9.7pt; color:var(--muted); }
  .toc a{ color:inherit; text-decoration:none; }

  /* Body */
  h1.doc-h1{ color:var(--brand-navy); font-size:22pt; margin:.1em 0 .4em; line-height:1.15;
    border-bottom:3px solid var(--brand-primary); padding-bottom:.18em; page-break-before:always; }
  h1.doc-h1:first-of-type{ page-break-before:avoid; }
  h2{ color:var(--brand-deep); font-size:15pt; margin:1.1em 0 .35em; }
  h3{ color:var(--brand-primary); font-size:12pt; margin:1em 0 .3em; }
  h4{ color:var(--brand-navy); font-size:10.8pt; margin:.9em 0 .25em; }
  p{ margin:.45em 0; } strong{ color:var(--brand-navy); }
  a{ color:var(--brand-deep); }
  ul,ol{ margin:.4em 0 .6em; padding-left:1.3em; } li{ margin:.18em 0; }
  hr{ border:none; border-top:1px solid var(--line); margin:1.2em 0; }
  code{ font-family:Consolas,Monaco,monospace; font-size:9pt; background:var(--light-blue);
    padding:1px 5px; border-radius:4px; color:var(--brand-deep); }
  pre{ background:#0E1014; color:#E7EAF0; padding:12px 14px; border-radius:8px; overflow:auto;
    font-size:8.6pt; page-break-inside:avoid; } pre code{ background:none; color:inherit; padding:0; }
  blockquote{ margin:.8em 0; padding:8px 14px; background:var(--light-blue);
    border-left:4px solid var(--brand-primary); border-radius:4px; color:#33415c; }
  blockquote p{ margin:.2em 0; }

  /* Tables */
  table{ border-collapse:collapse; width:100%; margin:.8em 0; font-size:9.2pt; page-break-inside:auto; }
  th,td{ border:1px solid var(--line); padding:6px 9px; text-align:left; vertical-align:top; }
  thead th{ background:var(--light-blue); color:var(--brand-deep); font-weight:700;
    border-bottom:2px solid var(--brand-primary); }
  tbody tr:nth-child(even){ background:#f6f9ff; }
  `;
}

function buildCover(logoUri, dateStr) {
  const logo = logoUri
    ? `<img class="cover__logo" src="${logoUri}" alt="Sentinel" />`
    : `<div class="cover__logo-fallback">SENTINEL</div>`;
  return `<div class="cover">${logo}<div class="cover__rule"></div>` +
    `<h1 class="cover__title">Business Plan</h1>` +
    `<p class="cover__subtitle">Sentinel · Operations &amp; Security Console</p>` +
    `<div class="cover__meta">Bootstrapped Multi-Tenant SaaS · Generated ${htmlEscape(dateStr)}</div>` +
    `<div><span class="cover__badge">Confidential · Internal / Investor-Restricted</span></div></div>`;
}

function buildToc(toc) {
  const items = toc.map((t) =>
    `<li class="lvl${t.level}"><a href="#${t.slug}">${htmlEscape(t.text)}</a></li>`
  ).join('');
  return `<section class="toc"><h2>Contents</h2><ol>${items}</ol></section>`;
}

// --- Main ----------------------------------------------------------------
function main() {
  const dateStr = process.argv[2] || '2026-06-16';
  if (!fs.existsSync(SRC_MD)) { console.error(`[plan-pdf] source not found: ${SRC_MD}`); process.exit(1); }
  let md = fs.readFileSync(SRC_MD, 'utf8');

  // Drop the first H1 + version line from the body (they live on the cover).
  md = md.replace(/^#\s+Sentinel\s+—\s+Business Plan\s*\n/, '');

  const logoUri = tryDataUri(BRAND_LOGO_LIGHT);
  const toc = extractToc(md);
  marked.setOptions({ renderer: buildRenderer(), gfm: true, breaks: false });
  const bodyHtml = marked.parse(md);

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
    `<title>Sentinel — Business Plan</title><style>${buildCss()}</style></head><body>` +
    buildCover(logoUri, dateStr) +
    buildToc(toc) +
    `<main>${bodyHtml}</main>` +
    `</body></html>`;

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const htmlForUrl = OUT_HTML.replace(/\\/g, '/');
  const pdfForCmd = OUT_PDF.replace(/\\/g, '/');
  console.log(`[plan-pdf] Wrote HTML -> ${OUT_HTML}`);
  console.log(`[plan-pdf] TOC entries: ${toc.length}`);
  console.log(`[plan-pdf] Logo embed : ${logoUri ? 'yes' : 'NO (text fallback)'}`);
  console.log('');
  console.log('Next — render the PDF with headless Chrome:');
  console.log(`chrome --headless=new --no-pdf-header-footer --print-to-pdf="${pdfForCmd}" "file:///${htmlForUrl}"`);
}

main();
