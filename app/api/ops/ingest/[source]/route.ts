// Webhook-in ingest path. External / CI scanners (npm-audit, gitleaks, trivy, …)
// POST their real findings here, signed with an HMAC over the raw body. This is
// the "webhook-in" complement to the worker's in-network header scan: instead of
// Sentinel reaching out, the scanner pushes findings in. Each `source` upserts
// into ops.findings (keyed on the UNIQUE `fingerprint`) and self-heals fixed
// findings when a later scan no longer reports them.
//
// Auth: header `x-ingest-signature` must equal HMAC-SHA256(rawBody, OPS_INGEST_SECRET).
//   - OPS_INGEST_SECRET unset      → 503 { error: 'ingest not configured' }
//   - signature missing / mismatch → 401 { error: '...' }

import crypto from 'crypto';
import { hasDb, q, q1 } from '@/lib/db';

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

// Timing-safe compare of two hex signatures.
function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// Sources whose findings are non-deterministic (e.g. the AI security review)
// OPT OUT of auto self-heal: a finding the model simply fails to re-surface on a
// later run must NOT be silently marked 'fixed'. Operators resolve these manually
// in the Sentinel UI (and can override-lock to persist a decision).
const SELF_HEAL_EXCLUDED_SOURCES = new Set(['ai-review']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const secret = process.env.OPS_INGEST_SECRET;
    if (!secret) {
      return Response.json({ error: 'ingest not configured' }, { status: 503 });
    }

    const { source } = await params;

    // Read the RAW body first — the HMAC must be computed over exactly the bytes
    // the client signed, before any JSON re-serialisation.
    const raw = await req.text();

    const provided = req.headers.get('x-ingest-signature') ?? '';
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!provided || !signatureMatches(expected, provided)) {
      return Response.json({ error: 'invalid signature' }, { status: 401 });
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
    }

    // Reconcile / self-heal: any auto-managed, non-override-locked finding for
    // THIS source that was NOT in this payload is now considered fixed. Guard on
    // a non-empty payload so a failed/empty scan doesn't mass-close real findings.
    let resolved = 0;
    if (seenFingerprints.length > 0 && !SELF_HEAL_EXCLUDED_SOURCES.has(source)) {
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
