import { describe, it, expect, beforeAll } from 'vitest';
import { NODB, hasDbUrl, SKIP_MESSAGE } from './_helpers';

// ---------------------------------------------------------------------------
// AUDIT — immutable, hash-chained log against REAL Postgres.
//
// Proves three real behaviours of ops.hermes_audit_log + lib/hermes/audit.ts:
//   1. appendAudit writes chained rows and verifyChain() recomputes them OK.
//   2. A retroactive UPDATE is rejected by the append-only trigger.
//   3. A DELETE is rejected too — history cannot be erased.
// ---------------------------------------------------------------------------

import { appendAudit, verifyChain } from '@/lib/hermes/audit';
import { q, q1 } from '@/lib/db';

if (NODB) {
  // eslint-disable-next-line no-console
  console.log(`[audit.test] ${SKIP_MESSAGE}`);
}

describe.runIf(NODB)('audit (skipped, no DATABASE_URL)', () => {
  it('no DB — skipped', () => {
    expect(hasDbUrl).toBe(false);
  });
});

describe.skipIf(NODB)('AUDIT: append-only hash chain (real SQL)', () => {
  beforeAll(async () => {
    // Isolate the chain to this run so verifyChain() covers exactly our rows.
    // TRUNCATE is not an UPDATE/DELETE so the append-only trigger does not fire.
    await q('truncate table ops.hermes_audit_log restart identity');
  });

  it('appends a chain and verifyChain() passes', async () => {
    await appendAudit({ actor: 'billing', action: 'proposal.created', summary: 'created', detail: { a: 1 } });
    await appendAudit({ actor: 'ben', action: 'proposal.approved', summary: 'approved', detail: { b: 2 } });
    await appendAudit({ actor: 'ben', action: 'proposal.executed', tool: 'refund', summary: 'executed', detail: { c: 3 } });

    const v = await verifyChain();
    expect(v.ok).toBe(true);
    expect(v.count).toBe(3);
    expect(v.brokenAtSeq).toBeNull();

    // Genesis row links to null; each subsequent prev_hash chains to the prior row.
    const rows = await q<any>(
      'select seq, prev_hash, row_hash from ops.hermes_audit_log order by seq asc',
    );
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[1].prev_hash).toBe(rows[0].row_hash);
    expect(rows[2].prev_hash).toBe(rows[1].row_hash);
  });

  it('rejects an UPDATE — the log is append-only', async () => {
    const first = await q1<any>('select seq from ops.hermes_audit_log order by seq asc limit 1');
    await expect(
      q('update ops.hermes_audit_log set summary = $2 where seq = $1', [first.seq, 'TAMPERED']),
    ).rejects.toThrow(/append-only/i);

    // The row is untouched, so the chain is still valid.
    const v = await verifyChain();
    expect(v.ok).toBe(true);
  });

  it('rejects a DELETE — history cannot be erased', async () => {
    const first = await q1<any>('select seq from ops.hermes_audit_log order by seq asc limit 1');
    await expect(
      q('delete from ops.hermes_audit_log where seq = $1', [first.seq]),
    ).rejects.toThrow(/append-only/i);

    const v = await verifyChain();
    expect(v.ok).toBe(true);
    expect(v.count).toBe(3);
  });
});
