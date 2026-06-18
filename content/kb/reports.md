# Reports & Compliance

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Reports** (route `/reports`) builds shareable, branded documents from Sentinel's data:
security-posture summaries, evidence packs for audits/compliance, and exports of KB content.
It is how you take what's on screen and turn it into something you can hand to a stakeholder.

![Reports — build a posture PDF and view history](./images/reports-build.png)

## How to use it

- **Build & history** (`/reports`) — generate a new report or open a past one.
- **Posture report** (`/reports/posture`) — a branded posture **PDF** plus an evidence pack
  (current findings by severity, open tickets, recent scans).
- **Generated report** (`/reports/[id]`) — a specific saved report.

## How it works (technical)

- A posture report snapshots live data at generation time: `ops.findings` (by severity),
  `ops.tickets`, recent `ops.jobs`/scan runs, and platform stats from the Supabase connector.
- KB articles in `content/kb/*.md` are the source content rendered into the document — this
  KB and the PDF export share one source of truth.
- Output follows the company brand spec (red headers, dark banner) and includes a **table of
  contents as page 2**, consistent with all Sentinel/YT documents.

## Common tasks

- **Produce a board-ready posture PDF:** Reports → Generate posture PDF.
- **Assemble an audit evidence pack:** generate posture with evidence included, then file the
  saved report.
- **Re-export after a fix:** regenerate to capture the improved posture snapshot.

## Troubleshooting

- **Report shows stale numbers** — it's a point-in-time snapshot; regenerate after changes.
- **Platform stats missing in the report** — the Supabase connector wasn't live at generation;
  fix it in Settings → Connectors and regenerate.
- **PDF fails to render** — check that the source KB markdown is valid and the brand assets
  resolve.

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | Can't snapshot `ops` data | Check DB / `DATABASE_URL` |
| `no connector` | Platform stats unavailable | Configure Settings → Connectors |
| `report generation failed` | Render pipeline error | Check source markdown / brand assets / logs |
