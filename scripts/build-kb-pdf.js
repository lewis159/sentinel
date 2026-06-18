/*
 * build-kb-pdf.js — Branded, picture-rich PDF generator for the Sentinel Knowledge Base.
 *
 * WHAT IT DOES
 *   Reads every markdown file in content/kb/*.md (index first, then section files in a
 *   sensible reading order, then the technical files), converts each to HTML with `marked`,
 *   rewrites ./images/x.png references to base64-embedded data URIs (or a labelled
 *   placeholder box when the screenshot has not been captured yet), and assembles ONE
 *   self-contained, print-optimised HTML document with a navy brand cover + table of
 *   contents. It writes that HTML to a temp path and prints the exact Chrome command to
 *   turn it into documents/Sentinel_Knowledge_Base.pdf.
 *
 * TWO-STEP PIPELINE (this script cannot run Chrome itself)
 *   1) Build the HTML:
 *        node scripts/build-kb-pdf.js ["2026-06-16"]
 *      -> writes C:/Users/Ben/AppData/Local/Temp/secmock/kb.html
 *      -> prints the Chrome command to run.
 *   2) Render the PDF with headless Chrome (the orchestrator runs this):
 *        chrome --headless=new --no-pdf-header-footer \
 *               --print-to-pdf="C:/dev/sentinel/code/documents/Sentinel_Knowledge_Base.pdf" \
 *               "file:///C:/Users/Ben/AppData/Local/Temp/secmock/kb.html"
 *   3) (optional) Post-process / compress raster output with sharp or Ghostscript for
 *      smaller file size / higher screenshot quality.
 *
 * DEPENDENCIES: only `marked` + Node builtins. No TypeScript, no Chrome at build time.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths & configuration
// ---------------------------------------------------------------------------
const CODE_ROOT = path.resolve(__dirname, '..');            // C:/dev/sentinel/code
const KB_DIR = path.join(CODE_ROOT, 'content', 'kb');
const IMAGES_DIR = path.join(KB_DIR, 'images');
const OUT_HTML = 'C:/Users/Ben/AppData/Local/Temp/secmock/kb.html';
const OUT_PDF = path.join(CODE_ROOT, 'documents', 'Sentinel_Knowledge_Base.pdf');

// Brand assets (white lockup for the dark cover + the icon).
const BRAND_LOGO_LIGHT =
  'Z:/GIT/Cursor/new project/sentinel/documents/brand/logo/sentinel-logo-light.png';
const BRAND_ICON =
  'Z:/GIT/Cursor/new project/sentinel/documents/brand/logo/sentinel-icon.png';

// Brand palette (Sentinel = blue).
const BRAND = {
  primary: '#2D6CFF',
  deep: '#1B4DD1',
  navy: '#0B1B3B',
  bannerFrom: '#0B1424',
  bannerTo: '#14233F',
};

// Document order: index first, then section files in a sensible reading order,
// then the technical files last. Any *.md not listed here is appended (sorted)
// so new articles are never silently dropped.
const PREFERRED_ORDER = [
  // overview / navigation
  'index',
  'overview',
  'graph',
  // security workspace
  'findings',
  'tickets',
  'scans',
  'users',
  'alerts',
  'incidents',
  // operations workspace
  'infra',
  'components',
  'reports',
  'settings-connectors',
  'knowledge-base',
  // technical references (last)
  'build-process',
  'architecture',
  'troubleshooting',
  'error-codes',
  'ha-runbook',
];

// Nicer display titles for slugs (falls back to a Title-Cased slug otherwise).
const TITLE_OVERRIDES = {
  index: 'Introduction',
  'settings-connectors': 'Settings & Connectors',
  'knowledge-base': 'Knowledge Base',
  'build-process': 'Build Process',
  'ha-runbook': 'HA Runbook',
  'error-codes': 'Error Codes',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugToTitle(slug) {
  if (TITLE_OVERRIDES[slug]) return TITLE_OVERRIDES[slug];
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fileToDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function tryDataUri(absPath) {
  try {
    if (fs.existsSync(absPath)) return fileToDataUri(absPath);
  } catch (_) {
    /* ignore — treated as missing */
  }
  return null;
}

// Discover the markdown files and return them in the desired order.
function listKbDocs() {
  const all = fs
    .readdirSync(KB_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => f.replace(/\.md$/i, ''));

  const seen = new Set();
  const ordered = [];
  for (const slug of PREFERRED_ORDER) {
    if (all.includes(slug) && !seen.has(slug)) {
      ordered.push(slug);
      seen.add(slug);
    }
  }
  // Append any markdown not in the preferred list (alphabetical, stable).
  for (const slug of all.sort()) {
    if (!seen.has(slug)) {
      ordered.push(slug);
      seen.add(slug);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Image rewriting
//   After marked produces HTML, replace every <img src="./images/x.png" alt="...">
//   with either an embedded data URI <figure> or a styled .shot-missing placeholder.
// ---------------------------------------------------------------------------
function rewriteImages(html) {
  // Match <img ...> tags (marked emits self-closing-ish <img .../> or <img ...>).
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\ssrc\s*=\s*"([^"]*)"/i);
    const altMatch = tag.match(/\salt\s*=\s*"([^"]*)"/i);
    const src = srcMatch ? srcMatch[1] : '';
    const alt = altMatch ? altMatch[1] : '';
    const caption = alt || 'Screenshot';

    // Only rewrite local ./images/ refs; leave anything else as-is.
    const localMatch = src.match(/(?:\.\/)?images\/([^"'?#]+)/i);
    if (!localMatch) return tag;

    const fileName = localMatch[1];
    const absPath = path.join(IMAGES_DIR, fileName);
    const dataUri = tryDataUri(absPath);

    if (dataUri) {
      return (
        `<figure class="shot">` +
        `<img src="${dataUri}" alt="${htmlEscape(alt)}" />` +
        `<figcaption>${htmlEscape(caption)}</figcaption>` +
        `</figure>`
      );
    }
    // Missing screenshot -> labelled placeholder box.
    return (
      `<div class="shot-missing">` +
      `<span class="shot-missing__icon">\u{1F4F7}</span>` +
      `<span class="shot-missing__cap">${htmlEscape(caption)}</span>` +
      `<span class="shot-missing__file">images/${htmlEscape(fileName)}</span>` +
      `</div>`
    );
  });
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
    position:relative;
    height:265mm;
    margin:-18mm -16mm 0 -16mm;            /* bleed to page edges */
    padding:34mm 24mm;
    background:linear-gradient(150deg,var(--banner-from) 0%,var(--banner-to) 100%);
    color:#fff;
    page-break-after:always;
    display:flex; flex-direction:column;
  }
  .cover__logo{ height:46px; width:auto; align-self:flex-start; margin-bottom:auto; }
  .cover__logo-fallback{ font-size:26pt; font-weight:800; letter-spacing:.5px; color:#fff; align-self:flex-start; margin-bottom:auto; }
  .cover__title{ font-size:44pt; font-weight:800; line-height:1.05; margin:0 0 8px; }
  .cover__subtitle{ font-size:16pt; font-weight:500; color:#b9c8e8; margin:0 0 26px; }
  .cover__rule{ width:96px; height:5px; border-radius:3px; background:var(--brand-primary); margin:0 0 22px; }
  .cover__meta{ font-size:11pt; color:#9fb2d8; }
  .cover__badge{
    display:inline-block; margin-top:18px; padding:7px 16px; border-radius:999px;
    background:rgba(45,108,255,.18); border:1px solid rgba(45,108,255,.55);
    color:#cfe0ff; font-size:9.5pt; font-weight:600; letter-spacing:.4px; text-transform:uppercase;
  }
  .cover__icon{ position:absolute; right:24mm; bottom:30mm; width:120px; opacity:.9; }

  /* ---- Table of contents ---- */
  .toc{ page-break-after:always; }
  .toc h2{ color:var(--brand-deep); font-size:22pt; margin:0 0 4px; }
  .toc__sub{ color:var(--muted); margin:0 0 18px; }
  .toc ol{ list-style:none; counter-reset:toc; padding:0; margin:0; }
  .toc li{
    counter-increment:toc; display:flex; align-items:baseline;
    padding:8px 0; border-bottom:1px solid var(--line);
  }
  .toc li::before{
    content:counter(toc,decimal-leading-zero);
    color:var(--brand-primary); font-weight:700; font-variant-numeric:tabular-nums;
    width:34px; flex:0 0 34px;
  }
  .toc__name{ font-weight:600; }

  /* ---- Section ---- */
  .section{ page-break-before:always; }
  .section__kicker{
    display:inline-block; font-size:8.5pt; font-weight:700; letter-spacing:1px;
    text-transform:uppercase; color:var(--brand-primary);
    border:1px solid var(--light-blue); background:var(--light-blue);
    padding:3px 10px; border-radius:6px; margin-bottom:6px;
  }

  /* ---- Typography ---- */
  h1{ color:var(--brand-navy); font-size:24pt; margin:.1em 0 .35em; line-height:1.15;
      border-bottom:3px solid var(--brand-primary); padding-bottom:.18em; }
  h2{ color:var(--brand-deep); font-size:16pt; margin:1.1em 0 .35em; }
  h3{ color:var(--brand-primary); font-size:12.5pt; margin:1em 0 .3em; }
  h4{ color:var(--ink); font-size:11pt; margin:.9em 0 .25em; }
  h1,h2,h3,h4{ page-break-after:avoid; }
  p{ margin:.45em 0; }
  a{ color:var(--brand-deep); text-decoration:none; }
  ul,ol{ margin:.4em 0 .6em 1.2em; padding:0; }
  li{ margin:.2em 0; }
  strong{ color:var(--brand-navy); }
  hr{ border:none; border-top:1px solid var(--line); margin:1.4em 0; }

  /* ---- Tables ---- */
  table{ border-collapse:collapse; width:100%; margin:.8em 0; font-size:9.5pt;
         page-break-inside:avoid; }
  th,td{ border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top; }
  thead th{ background:var(--light-blue); color:var(--brand-deep); font-weight:700;
            border-bottom:2px solid var(--brand-primary); }
  tbody tr:nth-child(even){ background:#f6f9ff; }

  /* ---- Code ---- */
  code{ font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
        font-size:9pt; background:var(--light-blue); color:var(--brand-deep);
        padding:1px 5px; border-radius:4px; }
  pre{ background:#0d1b35; color:#e7eefc; border-radius:8px; padding:12px 14px;
       overflow:auto; font-size:8.8pt; line-height:1.5; page-break-inside:avoid;
       border:1px solid #16264a; }
  pre code{ background:none; color:inherit; padding:0; }

  /* ---- Blockquotes ---- */
  blockquote{ margin:.8em 0; padding:.5em 1em; border-left:4px solid var(--brand-primary);
              background:var(--light-blue); color:#23365c; border-radius:0 6px 6px 0; }
  blockquote p{ margin:.2em 0; }

  /* ---- Figures / screenshots ---- */
  figure.shot{ margin:1em 0; page-break-inside:avoid; text-align:center; }
  figure.shot img{ max-width:100%; max-height:150mm; height:auto;
                   border:1px solid var(--line); border-radius:8px;
                   box-shadow:0 1px 4px rgba(11,27,59,.12); }
  figure.shot figcaption{ margin-top:6px; font-size:8.8pt; color:var(--muted);
                          font-style:italic; }

  /* ---- Missing-screenshot placeholder ---- */
  .shot-missing{
    margin:1em 0; padding:26px 18px; page-break-inside:avoid;
    border:2px dashed var(--brand-primary); border-radius:10px;
    background:repeating-linear-gradient(45deg,#f3f7ff,#f3f7ff 12px,#eaf1ff 12px,#eaf1ff 24px);
    color:var(--muted); text-align:center;
    display:flex; flex-direction:column; align-items:center; gap:4px;
  }
  .shot-missing__icon{ font-size:20pt; line-height:1; }
  .shot-missing__cap{ color:var(--brand-deep); font-weight:600; font-size:10pt; }
  .shot-missing__file{ font-family:Consolas,monospace; font-size:8pt; color:var(--muted); }
  `;
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------
async function main() {
  const { marked } = await import('marked');
  marked.setOptions({ mangle: false, headerIds: false, gfm: true, breaks: false });

  const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);

  // Resolve brand assets (embed as data URIs; fall back to text lockup on cover).
  const logoUri = tryDataUri(BRAND_LOGO_LIGHT);
  const iconUri = tryDataUri(BRAND_ICON);

  const slugs = listKbDocs();
  console.log(`[kb-pdf] Found ${slugs.length} KB markdown file(s).`);

  // Render each doc.
  let missingShots = 0;
  const sectionsHtml = [];
  const tocItems = [];

  for (const slug of slugs) {
    const mdPath = path.join(KB_DIR, `${slug}.md`);
    const md = fs.readFileSync(mdPath, 'utf8');
    let docHtml = await marked.parse(md);

    // Count placeholders for the build report.
    const before = docHtml;
    docHtml = rewriteImages(docHtml);
    const placeholderCount = (docHtml.match(/class="shot-missing"/g) || []).length;
    missingShots += placeholderCount;

    const title = slugToTitle(slug);
    tocItems.push(title);
    sectionsHtml.push(
      `<section class="section" id="sec-${htmlEscape(slug)}">` +
        `<span class="section__kicker">${htmlEscape(title)}</span>` +
        docHtml +
        `</section>`
    );
    void before;
  }

  // Cover logo markup.
  const coverLogo = logoUri
    ? `<img class="cover__logo" src="${logoUri}" alt="Sentinel" />`
    : `<div class="cover__logo-fallback">SENTINEL</div>`;
  const coverIcon = iconUri ? `<img class="cover__icon" src="${iconUri}" alt="" />` : '';

  // Table of contents.
  const tocHtml =
    `<div class="toc">` +
    `<h2>Table of Contents</h2>` +
    `<p class="toc__sub">Sentinel Operations &amp; Security Console — Knowledge Base</p>` +
    `<ol>` +
    tocItems.map((t) => `<li><span class="toc__name">${htmlEscape(t)}</span></li>`).join('') +
    `</ol>` +
    `</div>`;

  // Cover.
  const coverHtml =
    `<div class="cover">` +
    coverLogo +
    `<div class="cover__rule"></div>` +
    `<h1 class="cover__title">Knowledge Base</h1>` +
    `<p class="cover__subtitle">Operations &amp; Security Console</p>` +
    `<div class="cover__meta">Generated ${htmlEscape(dateStr)}</div>` +
    `<div><span class="cover__badge">Confidential · Internal</span></div>` +
    coverIcon +
    `</div>`;

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
    `<title>Sentinel Knowledge Base</title>` +
    `<style>${buildCss()}</style></head><body>` +
    coverHtml +
    tocHtml +
    sectionsHtml.join('\n') +
    `</body></html>`;

  // Ensure output dirs exist.
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  // Report.
  const htmlForUrl = OUT_HTML.replace(/\\/g, '/');
  const pdfForCmd = OUT_PDF.replace(/\\/g, '/');
  console.log(`[kb-pdf] Wrote HTML  -> ${OUT_HTML}`);
  console.log(`[kb-pdf] Sections    : ${slugs.length}`);
  console.log(`[kb-pdf] Logo embed  : ${logoUri ? 'yes' : 'NO (text fallback)'}`);
  console.log(`[kb-pdf] Screenshots : ${missingShots} missing (placeholders rendered)`);
  console.log('');
  console.log('Next step — render the PDF with headless Chrome:');
  console.log(
    `Run: chrome --headless=new --no-pdf-header-footer ` +
      `--print-to-pdf="${pdfForCmd}" "file:///${htmlForUrl}"`
  );
}

main().catch((err) => {
  console.error('[kb-pdf] FAILED:', err);
  process.exit(1);
});
