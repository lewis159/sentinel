# Sentinel Knowledge Base — Branded PDF

`scripts/build-kb-pdf.js` turns the Knowledge Base markdown in `content/kb/*.md`
into one branded, picture-rich, print-ready PDF: `documents/Sentinel_Knowledge_Base.pdf`.

The pipeline is two steps because the build script intentionally does **not** run a
browser — it produces a self-contained HTML file and prints the exact Chrome command
to render it.

```
markdown ──► build-kb-pdf.js ──► kb.html ──► chrome --print-to-pdf ──► Sentinel_Knowledge_Base.pdf
            (marked + Node)                  (headless Chrome)
```

Dependencies: `marked` (already in package.json) + Node builtins only.

---

## 1. Capture the screenshots

The markdown references screenshots as `![caption](./images/NAME.png)`. Put the PNGs in:

```
content/kb/images/
```

Use the same file names already referenced in the markdown, e.g.:

| File | Article |
|------|---------|
| `overview-shell.png`, `overview-dashboard.png` | Overview |
| `graph-explorer.png` | Graph |
| `findings-filters.png` | Findings |
| `tickets-queue.png` | Tickets |
| `scans-catalogue.png` | Scans |
| `users-risk.png` | User Audit |
| `alerts-inbox.png` | Alerts |
| `incident-timeline.png` | Incidents |
| `infra-containers.png` | Infra |
| `components-inventory.png` | Components |
| `reports-build.png` | Reports |
| `settings-connectors.png` | Settings & Connectors |
| `kb-browse.png` | Knowledge Base |
| `build-stack.png` | Build Process |
| `architecture-overview.png` | Architecture |
| `troubleshooting-badges.png` | Troubleshooting |
| `error-codes-ref.png` | Error Codes |
| `ha-topology.png` | HA Runbook |

> The full list is whatever `![...](./images/X.png)` appears in `content/kb/*.md`.
> A separate capture step (e.g. a Playwright/Chrome screenshot pass over the running app)
> drops PNGs here. **Any screenshot that is missing renders as a labelled dashed
> placeholder box** — so you can build the PDF before every shot exists and fill them in
> incrementally.

PNGs are embedded into the HTML as base64, so the final PDF is fully self-contained.

---

## 2. Build the HTML

```bash
node scripts/build-kb-pdf.js
# or pin the cover date:
node scripts/build-kb-pdf.js "2026-06-16"
```

This writes:

```
C:/Users/Ben/AppData/Local/Temp/secmock/kb.html
```

and prints a build summary plus the exact Chrome command to run, including a count of
how many screenshots are still missing (rendered as placeholders).

---

## 3. Render the PDF with headless Chrome

Run the command the script printed (paths shown for this machine):

```bash
chrome --headless=new --no-pdf-header-footer \
  --print-to-pdf="C:/dev/sentinel/code/documents/Sentinel_Knowledge_Base.pdf" \
  "file:///C:/Users/Ben/AppData/Local/Temp/secmock/kb.html"
```

On Windows the binary is usually one of:

```
"C:/Program Files/Google/Chrome/Application/chrome.exe"
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"   # Edge works too
```

Output:

```
documents/Sentinel_Knowledge_Base.pdf
```

---

## 4. (Optional) Post-process

- Compress / down-sample screenshots before embedding with **sharp** for a smaller PDF.
- Or shrink the rendered PDF with Ghostscript:
  ```bash
  gswin64c -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook \
    -o Sentinel_Knowledge_Base.compressed.pdf Sentinel_Knowledge_Base.pdf
  ```

---

## What the PDF contains

- **Navy gradient cover** — white Sentinel logo, title *Knowledge Base*, subtitle
  *Operations & Security Console*, generation date, and a *Confidential · Internal* badge.
- **Table of Contents** listing every section.
- **Each KB article** as its own section, page-broken, in reading order:
  index → overview/graph → security workspace → operations workspace →
  technical references (build-process, architecture, troubleshooting, error-codes, ha-runbook).
- Brand styling: blue headings, light-blue table headers, dark code blocks, blue
  blockquotes, captioned screenshots, and dashed placeholders for any screenshot not yet captured.
