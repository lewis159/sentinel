// Webhook-in ingest path. External / CI scanners (npm-audit, gitleaks, trivy, …)
// POST their real findings here, signed with an HMAC over the raw body. This is
// the "webhook-in" complement to the worker's in-network header scan: instead of
// Sentinel reaching out, the scanner pushes findings in. Each `source` upserts
// into ops.findings (keyed on the UNIQUE `fingerprint`) and self-heals fixed
// findings when a later scan no longer reports them.
//
// Auth: PRIVILEGED, HMAC-only. Header `x-ingest-signature` must equal
// HMAC-SHA256(rawBody, OPS_INGEST_SECRET). The least-privilege OPS_REPORT_TOKEN
// is NOT accepted here. No plaintext token mode (scanners always sign).
//   - OPS_INGEST_SECRET unset      → 503 { error: 'ingest not configured' }
//   - signature missing / mismatch → 401 { error: '...' }

import crypto from 'crypto';
import { hasDb, q, q1 } from '@/lib/db';
import { verifyPrivilegedHmac } from '@/lib/ingest-auth';

export const dynamic = 'force-dynamic';

type IncomingFinding = {
  fingerprint?: string;
  title: string;
  description?: string;
  severity: string;
  cvss?: number;
  cwe?: string;
  component?: string;
  evidence?: unknown;
};

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const { source } = await params;

    // Read the RAW body first — the HMAC must be computed over exactly the bytes
    // the client signed, before any JSON re-serialisation.
    const raw = await req.text();

    // --- Auth: PRIVILEGED, HMAC-only (OPS_INGEST_SECRET) ---
    const authed = verifyPrivilegedHmac(req, raw);
    if (!authed.ok) {
      return Response.json({ error: authed.error }, { status: authed.status });
    }

    if (!hasDb) {
      return Response.json({ error: 'no DB' }, { status: 503 });
    }

    let body: { findings?: IncomingFinding[] };
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const findings = Array.isArray(body.findings) ? body.findings : [];

    let upserted = 0;
    const seenFingerprints: string[] = [];

    for (const f of findings) {
      if (!f || !f.title) continue;
      const cwe = f.cwe ?? '';
      const component = f.component ?? '';
      // Stable fingerprint so repeat scans converge on the same row.
      const fingerprint =
        f.fingerprint && f.fingerprint.length > 0
          ? f.fingerprint
          : sha256Hex(`${source}:${cwe}:${component}:${f.title}`);
      seenFingerprints.push(fingerprint);

      const evidence = f.evidence ?? {};

      // Upsert on the UNIQUE fingerprint. On re-scan we refresh last_seen_at and
      // title; status is reset to 'open' unless an operator override locked it.
      await q(
        `insert into ops.findings
           (fingerprint, title, description, severity, cvss, cwe, component_label, source, status, evidence, first_seen_at, last_seen_at)
         values
           ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9::jsonb, now(), now())
         on conflict (fingerprint) do update set
           last_seen_at = now(),
           title       = excluded.title,
           description = excluded.description,
           severity    = excluded.severity,
           cvss        = excluded.cvss,
           cwe         = excluded.cwe,
           component_label = excluded.component_label,
           evidence    = excluded.evidence,
           resolved_at = null,
           status = case
             when ops.findings.override_locked then ops.findings.status
             else 'open'
           end`,
        [
          fingerprint,
          f.title,
          f.description ?? null,
          f.severity,
          f.cvss ?? null,
          cwe || null,
          component || null,
          source,
          JSON.stringify(evidence),
        ]
      );
      upserted++;

      // --- Auto-link the SPINE: finding --affects--> component ---
      // Resolve the free-text component_label to a real ops.components row
      // (hybrid derive-then-curate: upsert by key, operator can rename later),
      // then write an idempotent edge. The finding ref isn't returned by the
      // upsert above, so resolve it from the fingerprint. Best-effort: a failure
      // here must never fail the ingest of the finding itself.
      if (component) {
        try {
          const fr = await q1<{ ref: string }>(
            'select ref from ops.findings where fingerprint=$1',
            [fingerprint]
          );
          if (fr?.ref) {
            await q(
              `insert into ops.components (key, name, kind)
                 values ($1, $1, 'service')
               on conflict (key) do nothing`,
              [component]
            );
            await q(
              `insert into ops.links (src_type, src_id, dst_type, dst_id, relation, created_by)
                 values ('finding', $1, 'component', $2, 'affects', 'auto:ingest')
               on conflict (src_type, src_id, dst_type, dst_id, relation) do nothing`,
              [fr.ref, component]
            );
          }
        } catch {
          /* auto-link is best-effort; the finding upsert already succeeded */
        }
      }
    }

    // Reconcile / self-heal: any auto-managed, non-override-locked finding for
    // THIS source that was NOT in this payload is now considered fixed. Guard on
    // a non-empty payload so a failed/empty scan doesn't mass-close real findings.
    let resolved = 0;
    if (seenFingerprints.length > 0) {
      const result = await q1<{ n: string }>(
        `with closed as (
           update ops.findings
              set status = 'fixed', resolved_at = now()
            where source = $1
              and coalesce(override_locked, false) = false
              and status <> 'fixed'
              and not (fingerprint = any($2::text[]))
            returning 1
         )
         select count(*)::text as n from closed`,
        [source, seenFingerprints]
      );
      resolved = result ? Number(result.n) : 0;
    }

    return Response.json({ ok: true, upserted, resolved });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message ?? 'ingest failed' },
      { status: 500 }
    );
  }
}
