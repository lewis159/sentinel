# Sentinel — "Report issue" embeddable widget

A self-contained, dependency-free widget that any estate app (YT Transcriber,
Springsteen, future apps) can drop in to let users report bugs / issues. Reports
land in Sentinel as ITIL tickets in `ops.tickets` (the "data INTO Sentinel"
path), reachable from the Incidents / Requests sections.

- **Script:** `public/report-issue.js` (served at `https://ops.bentech.dev/report-issue.js`)
- **Ingest API:** `POST /api/ingest/issue`
- **Auth:** `OPS_REPORT_TOKEN` (dedicated, least-privilege widget token) — token
  or HMAC. The privileged `OPS_INGEST_SECRET` is ALSO accepted by this route for
  server-side callers, but it must NEVER be placed in a browser.
- **Not Clerk-gated** (estate apps have no Clerk session against Sentinel); the
  route is in the middleware PUBLIC matcher and authenticates in-route.

> **Least privilege.** `OPS_REPORT_TOKEN` only authorizes `/api/ingest/issue`
> (create a report ticket). It CANNOT post ticket updates, write the
> roadmap/changelog, or push findings — those routes require the privileged
> `OPS_INGEST_SECRET`, which is server/CI-only and never browser-exposed.

---

## 1. Embed (the easy path — token in a `data-*` attribute)

Add one tag, ideally just before `</body>`:

```html
<script
  src="https://ops.bentech.dev/report-issue.js"
  data-endpoint="https://ops.bentech.dev/api/ingest/issue"
  data-token="THE_OPS_REPORT_TOKEN"
  data-app="YT"
  defer></script>
```

| attribute       | required | description                                              |
| --------------- | -------- | -------------------------------------------------------- |
| `data-endpoint` | no*      | Ingest URL. Defaults to `/api/ingest/issue` (same-origin).|
| `data-token`    | yes      | `OPS_REPORT_TOKEN` for the estate (sent as `x-ingest-token`). Least privilege — only creates report tickets. |
| `data-app`      | yes      | App tag for the ticket: `YT` \| `Sentinel` \| `Bruce` \| `Estate`. |

*Required when the app is on a different origin from Sentinel (the usual case).

This injects a floating **"Report issue"** button (bottom-right). Clicking it
opens a modal that collects **title, description, type, severity** and
auto-fills the **current URL** and **app**. On success it shows
**"Reported as <ref>"** (e.g. `INC-0007`).

> The token is visible in the browser. That's acceptable because `OPS_REPORT_TOKEN`
> only grants "create a report ticket", nothing else. For an untrusted/public
> surface, use the HMAC path (section 3) via your own backend.

## 2. Config via JS instead of attributes

Set `window.SentinelReportIssue` **before** the script loads:

```html
<script>
  window.SentinelReportIssue = {
    endpoint: 'https://ops.bentech.dev/api/ingest/issue',
    token: 'THE_OPS_REPORT_TOKEN',
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
over the raw body instead, using EITHER the least-privilege `OPS_REPORT_TOKEN`
or the privileged `OPS_INGEST_SECRET` as the HMAC key:

```
x-ingest-signature: hex( HMAC-SHA256(rawBody, OPS_REPORT_TOKEN) )
```

This mirrors the existing scanner ingest at `/api/ops/ingest/*` (which signs with
`OPS_INGEST_SECRET`).

## 4. API contract

```
POST /api/ingest/issue
Content-Type: application/json
x-ingest-token: <OPS_REPORT_TOKEN>           # OR x-ingest-signature: <hmac>

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

| status | body                                  | cause                                                  |
| ------ | ------------------------------------- | ------------------------------------------------------ |
| 503    | `{ error: 'ingest not configured' }`  | neither `OPS_REPORT_TOKEN` nor `OPS_INGEST_SECRET` set |
| 401    | `{ error: 'invalid credentials' }`    | bad/missing token and HMAC                             |
| 400    | `{ error: 'title is required' }`      | missing title / bad JSON                               |

## 5. Setup checklist (Sentinel side)

1. Set `OPS_REPORT_TOKEN` in Sentinel's environment (the dedicated widget token;
   mounted from `/run/secrets/ops_report_token` in Swarm). `OPS_INGEST_SECRET`
   (already used by the scanner ingest) is also accepted by this route for
   server-side callers but must never be embedded in a browser.
2. Deploy — `report-issue.js` is served statically from `/report-issue.js`.
3. Add the `<script>` tag to each estate app with `data-token` set to
   `OPS_REPORT_TOKEN` (do this in the app's own repo — Sentinel does **not** wire
   itself into YT/Bruce).
