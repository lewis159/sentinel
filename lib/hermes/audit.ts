// Immutable, hash-chained audit log for Hermes safety events → ops.hermes_audit_log.
//
// Every safety-relevant event (a proposal being created / approved / dismissed /
// executed) is appended here as a tamper-evident row. Each row's `row_hash` is
//   sha256( prev_hash || canonical(entry) )
// where prev_hash is the row_hash of the immediately preceding row (by `seq`).
// Retroactively editing or deleting a row breaks the chain, which verifyChain()
// detects by recomputing every hash in order.
//
// DB writes go through the ops.* append-only table (a trigger + REVOKE block any
// UPDATE/DELETE at the DB). Hashing is done HERE so the canonical byte ordering
// is deterministic and identical on append and on verify — we never depend on
// Postgres jsonb re-serialisation ordering.
//
// Mock-safe: with no DB (hasDb === false) appendAudit is a no-op that still
// returns a computed row_hash (so callers/tests can chain in memory) and
// verifyChain reports an empty, valid chain.
import { createHash } from 'node:crypto';
import { hasDb, q, q1 } from '@/lib/db';

export type AuditAction =
  | 'proposal.created'
  | 'proposal.approved'
  | 'proposal.dismissed'
  | 'proposal.executed';

export type AuditEntry = {
  actor?: string | null;
  action: AuditAction;
  proposalId?: string | null;
  tenantRef?: string | null;
  tool?: string | null;
  summary?: string | null;
  detail?: Record<string, unknown>;
};

export type AuditRow = {
  seq: number;
  id: string;
  ts: string;
  actor: string | null;
  action: AuditAction;
  proposalId: string | null;
  tenantRef: string | null;
  tool: string | null;
  summary: string | null;
  detail: Record<string, unknown>;
  prevHash: string | null;
  rowHash: string;
};

// Canonical, stable serialisation of the hashed fields. Order is FIXED here (not
// object-key order) so the exact same bytes are produced on append and verify.
// `ts` is included so the timestamp is covered by the chain; the caller passes it
// on verify from the stored row.
function canonical(fields: {
  ts: string;
  actor: string | null;
  action: string;
  proposalId: string | null;
  tenantRef: string | null;
  tool: string | null;
  summary: string | null;
  detail: Record<string, unknown>;
}): string {
  return JSON.stringify([
    fields.ts,
    fields.actor ?? '',
    fields.action,
    fields.proposalId ?? '',
    fields.tenantRef ?? '',
    fields.tool ?? '',
    fields.summary ?? '',
    stableStringify(fields.detail ?? {}),
  ]);
}

// Deterministic JSON with sorted keys at every level, so detail payloads hash
// identically regardless of key insertion order.
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// The exported hash so tests / verifyChain use the exact same computation.
export function computeRowHash(
  prevHash: string | null,
  fields: {
    ts: string;
    actor: string | null;
    action: string;
    proposalId: string | null;
    tenantRef: string | null;
    tool: string | null;
    summary: string | null;
    detail: Record<string, unknown>;
  },
): string {
  return createHash('sha256')
    .update((prevHash ?? '') + canonical(fields))
    .digest('hex');
}

function normDetail(d: unknown): Record<string, unknown> {
  if (d && typeof d === 'object' && !Array.isArray(d)) return d as Record<string, unknown>;
  return {};
}

/**
 * Append one event to the hash-chained audit log and return the row (with its
 * computed row_hash). No-op persistence with no DB, but STILL returns a coherent
 * row (seq 0, prev_hash null) so in-memory callers/tests get a hash back.
 *
 * The prev_hash is read from the current tail inside the same call. This is the
 * intended single-writer audit path; concurrent appends are serialised by the
 * caller (each safety event appends once). A race would at worst produce two rows
 * sharing a prev_hash, which verifyChain surfaces as a break rather than hiding.
 */
export async function appendAudit(entry: AuditEntry): Promise<AuditRow> {
  const ts = new Date().toISOString();
  const fields = {
    ts,
    actor: entry.actor ?? null,
    action: entry.action,
    proposalId: entry.proposalId ?? null,
    tenantRef: entry.tenantRef ?? null,
    tool: entry.tool ?? null,
    summary: entry.summary ?? null,
    detail: normDetail(entry.detail),
  };

  if (!hasDb) {
    const rowHash = computeRowHash(null, fields);
    return { seq: 0, id: '', prevHash: null, rowHash, ...fields };
  }

  // Tail row_hash → prev_hash for the new row.
  const tail = await q1<{ row_hash: string }>(
    'select row_hash from ops.hermes_audit_log order by seq desc limit 1',
  );
  const prevHash = tail?.row_hash ?? null;
  const rowHash = computeRowHash(prevHash, fields);

  const inserted = await q1<{ seq: number; id: string; ts: unknown }>(
    `insert into ops.hermes_audit_log
       (ts, actor, action, proposal_id, tenant_ref, tool, summary, detail, prev_hash, row_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     returning seq, id, ts`,
    [
      ts,
      fields.actor,
      fields.action,
      fields.proposalId,
      fields.tenantRef,
      fields.tool,
      fields.summary,
      JSON.stringify(fields.detail),
      prevHash,
      rowHash,
    ],
  );

  return {
    seq: inserted ? Number(inserted.seq) : 0,
    id: inserted?.id ?? '',
    prevHash,
    rowHash,
    ...fields,
    ts: inserted?.ts
      ? inserted.ts instanceof Date
        ? (inserted.ts as Date).toISOString()
        : String(inserted.ts)
      : ts,
  };
}

export type ChainVerification = {
  ok: boolean;
  count: number;
  brokenAtSeq: number | null;
  reason?: string;
};

/**
 * Recompute the whole chain in `seq` order and confirm every row's stored
 * row_hash matches, that prev_hash links to the prior row's row_hash, and that
 * the genesis row's prev_hash is null. Returns the first break (if any).
 *
 * With no DB: an empty, valid chain.
 */
export async function verifyChain(): Promise<ChainVerification> {
  if (!hasDb) return { ok: true, count: 0, brokenAtSeq: null };

  const rows = await q<any>(
    `select seq, actor, action, proposal_id, tenant_ref, tool, summary, detail, prev_hash, row_hash,
            ts
       from ops.hermes_audit_log
      order by seq asc`,
  );

  let prev: string | null = null;
  for (const r of rows) {
    const ts = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
    const detail = typeof r.detail === 'string' ? safeParse(r.detail) : normDetail(r.detail);
    const expected = computeRowHash(prev, {
      ts,
      actor: r.actor ?? null,
      action: r.action,
      proposalId: r.proposal_id ?? null,
      tenantRef: r.tenant_ref ?? null,
      tool: r.tool ?? null,
      summary: r.summary ?? null,
      detail,
    });
    if ((r.prev_hash ?? null) !== prev) {
      return {
        ok: false,
        count: rows.length,
        brokenAtSeq: Number(r.seq),
        reason: 'prev_hash does not link to the prior row',
      };
    }
    if (r.row_hash !== expected) {
      return {
        ok: false,
        count: rows.length,
        brokenAtSeq: Number(r.seq),
        reason: 'row_hash does not match recomputed hash (row was altered)',
      };
    }
    prev = r.row_hash;
  }

  return { ok: true, count: rows.length, brokenAtSeq: null };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
