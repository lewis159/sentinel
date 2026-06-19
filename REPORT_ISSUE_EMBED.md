# Sentinel — "Report issue" embeddable widget

A self-contained, dependency-free widget that any estate app (YT Transcriber,
Springsteen, future apps) can drop in to let users report bugs / issues. Reports
land in Sentinel as ITIL tickets in `ops.tickets` (the "data INTO Sentinel"
path), reachable from the Incidents / Requests sections.

- **Script:** `public/report-issue.js` (served at `https://ops.bentech.dev/report-issue.js`)
- **Ingest API:** `POST /api/ingest/issue`
- **Auth:** `OPS_INGEST_SECRET` (shared estate secret) — token or HMAC
- **Not Clerk-gated** (estate apps have no Clerk session against Sentinel); the
  route is in the middleware PUBLIC matcher and authenticates in-route.

---

## 1. Embed (the easy path — token in a `data-*` attribute)

Add one tag, ideally just before `</body>`:

```html
<script
  src="https://ops.bentech.dev/report-issue.js"
  data-endpoint="https://ops.bentech.dev/api/ingest/issue"
  data-token="THE_OPS_INGEST_SECRET"
  data-app="YT"
  defer></script>
```

| attribute       | required | description                                              |
| --------------- | -------- | -------------------------------------------------------- |
| `data-endpoint` | no*      | Ingest URL. Defaults to `/api/ingest/issue` (same-origin).|
| `data-token`    | yes      | `OPS_INGEST_SECRET` for the estate (sent as `x-ingest-token`). |
| `data-app`      | yes      | App tag for the ticket: `YT` \| `Sentinel` \| `Bruce` \| `Estate`. |

*Required when the app is on a different origin from Sentinel (the usual case).

This injects a floating **"Report issue"** button (bottom-right). Clicking it
opens a modal that collects **title, description, type, severity** and
auto-fills the **current URL** and **app**. On success it shows
**"Reported as <ref>"** (e.g. `INC-0007`).

> The token is visible in the browser. That's acceptable for trusted internal
> estate apps — it only grants "create a report ticket", nothing else. For an
> untrusted/public surface, use the HMAC path (section 3) via your own backend.

## 2. Config via JS instead of attributes

Set `window.SentinelReportIssue` **before** the script loads:

```html
<script>
  window.SentinelReportIssue = {
    endpoint: 'https://ops.bentech.dev/api/ingest/issue',
    token: 'THE_OPS_INGEST_SECRET',
    app: 'Bruce',
    reporter: currentUser?.email,   // optional — stored in attrs.reporter
  };
</script>
<script src="https://ops.bentech.dev/report-issue.js" defer></script>
```

After load, `window.SentinelReportIssue.open()` opens the modal
programmatically — wire it to your own "Help → Report a bug" menu item and the
floating button still works too.

## 3. Server-to-server / HMAC (no token in the browser)

For callers that can sign requests server-side, skip the token and send an HMAC
over the raw body instead:

```
x-ingest-signature: hex( HMAC-SHA256(rawBody, OPS_INGEST_SECRET) )
```

This mirrors the existing scanner ingest at `/api/ops/ingest/*`.

## 4. API contract

```
POST /api/ingest/issue
Content-Type: application/json
x-ingest-token: <OPS_INGEST_SECRET>          # OR x-ingest-signature: <hmac>

{
  "app": "YT",                  // YT | Sentinel | Bruce | Estate
  "title": "Export button does nothing",
  "description": "Clicking Export on /library spins forever",
  "type": "bug",                // bug|incident|request|change|problem|release|feedback
  "severity": "high",           // critical|high|medium|low
  "url": "https://yt.bentech.dev/library",
  "reporter": "user@example.com"
}
```

Response:

```json
{ "ok": true, "ref": "INC-0007" }
```

Mapping into `ops.tickets` (via `createTicket`):

- `type` -> ticket **kind** (`bug`/`feedback`/unknown -> `incident`).
- `severity` -> **impact x urgency -> priority**.
- `status` = **`new`** (a report-inbox state). An operator triages it into the
  kind's normal workflow on the Sentinel detail pane (status/assignee controls).
- `source` = `report-issue`; `app` from the payload.
- `url`, `reporter`, original `type`/`severity` are captured in `attrs`.
- The returned **`ref`** (`INC-/REQ-/CHG-/PRB-/REL-####`) doubles as the error
  code shown back to the reporter.

### Error responses

| status | body                                  | cause                          |
| ------ | ------------------------------------- | ------------------------------ |
| 503    | `{ error: 'ingest not configured' }`  | `OPS_INGEST_SECRET` not set    |
| 401    | `{ error: 'invalid credentials' }`    | bad/missing token and HMAC     |
| 400    | `{ error: 'title is required' }`      | missing title / bad JSON       |

## 5. Setup checklist (Sentinel side)

1. Set `OPS_INGEST_SECRET` in Sentinel's environment (already used by the
   scanner ingest).
2. Deploy — `report-issue.js` is served statically from `/report-issue.js`.
3. Add the `<script>` tag to each estate app (do this in the app's own repo —
   Sentinel does **not** wire itself into YT/Bruce).
