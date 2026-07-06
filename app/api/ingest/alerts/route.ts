// Alert-ingest — the machine-callable "alerts INTO Sentinel" path. Grafana /
// Alertmanager POST their alert notifications here and Sentinel auto-creates
// deduped incidents, skipping the manual report-inbox triage entirely.
//
// This route is NOT Clerk-gated (it's in the middleware PUBLIC matcher). It is
// authenticated WITHOUT a Clerk session via verifyReportIngest — accepting
// EITHER `OPS_INGEST_SECRET` (privileged) OR `OPS_REPORT_TOKEN`, in EITHER mode:
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//              For server-to-server callers (Alertmanager can template a body
//              but not HMAC-sign it; a signing proxy can).
//   2. Token — header `x-ingest-token` OR `Authorization: Bearer <secret>`.
//              THIS is the path Grafana actually uses: a Grafana webhook contact
//              point can send a static bearer/Authorization header but CANNOT
//              HMAC-sign the request body, so the bearer path is what fires in
//              production. Compared timing-safely.
//
//   neither secret configured      → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid   → 401 { error: 'invalid credentials' }
//
//   POST /api/ingest/alerts
//   body (Grafana/Alertmanager default webhook JSON):
//     { alerts: [ { status: 'firing'|'resolved',
//                   labels: { alertname, severity, service?, app?, ... },
//                   annotations: { summary?, description? },
//                   fingerprint | dedup_key, startsAt?, ... } ], ... }
//   body (simple shape, also accepted):
//     { status?, title, severity?, service?/app?, description?, dedup_key, source? }
//   → 201 { ok: true, created: N, updated: M, resolved: K }
//
// Dedup is keyed on each alert's fingerprint/dedup_key, stashed at
// attrs.dedup_key on the ops.tickets row (no extra table / migration). For a
// FIRING alert: if an OPEN incident already exists for that key we heartbeat it
// (attrs.last_seen_at + firing_count) instead of creating a duplicate; otherwise
// we create a new kind='incident', status='open', source='grafana' ticket. For a
// RESOLVED alert we flip the matching open incident to status='resolved' and add
// a system comment. Idempotent + safe to call repeatedly (Grafana re-sends
// firing alerts on an interval).

import { hasDb, q, q1 } from '@/lib/db';
import { createTicket, addTicketComment } from '@/lib/data';
import { verifyReportIngest } from '@/lib/ingest-auth';
import type { Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// CORS: allow a browser/agent to POST from any origin. The token/HMAC is the
// real access control; CORS just lets the fetch succeed.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ingest-token, x-ingest-signature, Authorization',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// A single alert, normalized from either the Grafana/Alertmanager shape or the
// simple shape into the fields this route acts on.
type NormalizedAlert = {
  firing: boolean;
  dedupKey: string;
  title: string;
  description?: string;
  severity: string;
  app?: string;
  source: string;
  raw: unknown;
};

// Map an alert-severity label to a Sentinel priority band. Grafana/Alertmanager
// severities are free text; the common ones are critical|warning|info(+page).
function sevToPriority(severity?: string): Severity {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'page':
    case 'emergency':
      return 'critical';
    case 'high':
    case 'error':
      return 'high';
    case 'warning':
    case 'warn':
    case 'medium':
      return 'medium';
    case 'info':
    case 'low':
    case 'none':
      return 'low';
    default:
      return 'medium';
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// Normalize one raw alert object (Grafana/Alertmanager entry OR the simple
// shape). Returns null when there's not enough to act on (no dedup key AND no
// title/alertname to synthesize one).
function normalizeAlert(a: any, topStatus?: string): NormalizedAlert | null {
  if (!a || typeof a !== 'object') return null;
  const labels = (a.labels && typeof a.labels === 'object') ? a.labels : {};
  const annotations = (a.annotations && typeof a.annotations === 'object') ? a.annotations : {};

  // status: per-alert (Grafana) → top-level (some senders) → default firing.
  const status = str(a.status) ?? str(topStatus) ?? 'firing';
  const firing = status.toLowerCase() !== 'resolved';

  const alertname = str(labels.alertname) ?? str(a.alertname);
  const title =
    str(a.title) ??
    str(annotations.summary) ??
    alertname ??
    'Alert';

  const description =
    str(annotations.description) ??
    str(annotations.summary) ??
    str(a.description);

  const severity = str(labels.severity) ?? str(a.severity) ?? 'warning';
  const app = str(labels.app) ?? str(labels.service) ?? str(a.app) ?? str(a.service);
  const source = str(labels.source) ?? str(a.source) ?? 'grafana';

  // dedup key: explicit fingerprint/dedup_key wins; else derive a stable key
  // from alertname+service so repeated firings of the same rule converge.
  const dedupKey =
    str(a.fingerprint) ??
    str(a.dedup_key) ??
    str(labels.fingerprint) ??
    (alertname ? `${alertname}:${app ?? ''}` : undefined);

  if (!dedupKey) return null;

  return { firing, dedupKey, title, description, severity, app, source, raw: a };
}

// Find an OPEN incident (not resolved/closed) previously created for a dedup key.
async function findOpenIncidentByDedup(dedupKey: string): Promise<{ ref: string } | null> {
  return q1<{ ref: string }>(
    `select ref from ops.tickets
      where kind = 'incident'
        and attrs->>'dedup_key' = $1
        and status not in ('resolved', 'closed')
      order by opened_at desc nulls last
      limit 1`,
    [dedupKey]
  );
}

export async function POST(req: Request) {
  // Read the RAW body first so an HMAC (if used) is computed over the exact bytes.
  const raw = await req.text();

  // --- Auth: machine ingest — OPS_INGEST_SECRET or OPS_REPORT_TOKEN, token OR
  // HMAC. The bearer/token path is what Grafana's webhook contact point uses. ---
  const authed = verifyReportIngest(req, raw);
  if (!authed.ok) {
    return json({ error: authed.error }, authed.status);
  }

  if (!hasDb) {
    return json({ error: 'no DB' }, 503);
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  // Accept the Grafana/Alertmanager `{ alerts: [...] }` array, or treat the whole
  // body as a single simple alert.
  const rawAlerts: any[] = Array.isArray(body?.alerts)
    ? body.alerts
    : (body && typeof body === 'object' ? [body] : []);
  const topStatus = str(body?.status);

  let created = 0;
  let updated = 0;
  let resolved = 0;

  try {
    for (const rawAlert of rawAlerts) {
      const alert = normalizeAlert(rawAlert, topStatus);
      if (!alert) continue;

      if (alert.firing) {
        // Dedup: heartbeat an existing open incident instead of duplicating.
        const existing = await findOpenIncidentByDedup(alert.dedupKey);
        if (existing) {
          await q(
            `update ops.tickets
                set attrs = attrs
                  || jsonb_build_object('last_seen_at', now()::text)
                  || jsonb_build_object(
                       'firing_count',
                       (coalesce((attrs->>'firing_count')::int, 1) + 1)
                     ),
                    updated_at = now()
              where ref = $1`,
            [existing.ref]
          );
          updated++;
          continue;
        }

        // New incident — created OPEN (skip the 'new' report-inbox state) so it
        // lands straight in the incident workflow. Raw alert + dedup key stashed
        // in attrs for dedup + audit.
        await createTicket({
          kind: 'incident',
          title: alert.title,
          description: alert.description,
          app: alert.app ?? 'Estate',
          priority: sevToPriority(alert.severity),
          status: 'open',
          source: alert.source,
          attrs: {
            dedup_key: alert.dedupKey,
            severity: alert.severity,
            last_seen_at: new Date().toISOString(),
            firing_count: 1,
            alert: alert.raw,
          },
        });
        created++;
      } else {
        // Resolved: flip the matching open incident and note the auto-resolve.
        // No matching open incident → no-op (Grafana resends resolves too).
        const existing = await findOpenIncidentByDedup(alert.dedupKey);
        if (!existing) continue;
        await q(
          `update ops.tickets
              set status = 'resolved', resolved_at = now(), updated_at = now()
            where ref = $1`,
          [existing.ref]
        );
        try {
          await addTicketComment(
            existing.ref,
            `Auto-resolved from ${alert.source}: alert "${alert.title}" (dedup ${alert.dedupKey}) reported resolved.`,
            'System',
            'update'
          );
        } catch {
          /* comment is best-effort; the resolve already succeeded */
        }
        resolved++;
      }
    }

    return json({ ok: true, created, updated, resolved }, 201);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'ingest failed' }, 500);
  }
}
