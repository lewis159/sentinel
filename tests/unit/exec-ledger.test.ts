import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Exactly-once execution ledger (lib/hermes/exec-ledger.ts). Mocks '@/lib/db'
// the tenant-tickets.test.ts way: hasDb forced true, q/q1 are spies that return
// canned rows so the INSERT ... ON CONFLICT ... RETURNING path is exercised.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const q1Returns: any[] = [];
  const q1 = vi.fn(async (_text: string, _params?: any[]) =>
    q1Returns.length ? q1Returns.shift() : null,
  );
  const q = vi.fn(async () => []);
  return { state, q1Returns, q1, q };
});
const { q1Returns, q1, q } = H;

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

import { claimExecution, recordResult, getExecution } from '@/lib/hermes/exec-ledger';

beforeEach(() => {
  H.state.dbPresent = true;
  q1Returns.length = 0;
  q1.mockClear();
  q.mockClear();
});

describe('claimExecution exactly-once', () => {
  it('first caller INSERTs and wins (row returned)', async () => {
    q1Returns.push({ id: 'exec-1' }); // ON CONFLICT DO NOTHING RETURNING id → row
    const res = await claimExecution('idem-key-A', 'prop-1', 'refund');
    expect(res.won).toBe(true);
    expect(res.id).toBe('exec-1');
    expect(res.alreadyClaimed).toBe(false);

    const [sql, params] = q1.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/i);
    expect(sql).toMatch(/returning id/i);
    expect(params).toEqual(['prop-1', 'refund', 'idem-key-A']);
  });

  it('second caller with the same key loses (no row returned)', async () => {
    q1Returns.push(null);              // INSERT conflicted → no row
    q1Returns.push({ id: 'exec-1' });  // follow-up lookup of the existing row
    const res = await claimExecution('idem-key-A', 'prop-1', 'refund');
    expect(res.won).toBe(false);
    expect(res.alreadyClaimed).toBe(true);
    expect(res.id).toBe('exec-1'); // correlates to the winner's row
  });

  it('no DB → wins by default (nothing to arbitrate in dev)', async () => {
    H.state.dbPresent = false;
    const res = await claimExecution('idem-key-A', 'prop-1', 'refund');
    expect(res.won).toBe(true);
    expect(res.id).toBeNull();
    expect(q1).not.toHaveBeenCalled();
  });
});

describe('recordResult', () => {
  it('updates status + result for the claimed key', async () => {
    await recordResult('idem-key-A', 'succeeded', { refunded: 1500 });
    const [sql, params] = q1.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/update ops\.hermes_tool_executions/i);
    expect(params[0]).toBe('idem-key-A');
    expect(params[1]).toBe('succeeded');
    expect(JSON.parse(params[2])).toEqual({ refunded: 1500 });
  });

  it('no DB → no-op', async () => {
    H.state.dbPresent = false;
    await recordResult('idem-key-A', 'failed');
    expect(q1).not.toHaveBeenCalled();
  });
});

describe('getExecution', () => {
  it('maps a found row and parses stringified result jsonb', async () => {
    q1Returns.push({ id: 'exec-1', tool: 'refund', status: 'succeeded', result: JSON.stringify({ ok: true }) });
    const row = await getExecution('idem-key-A');
    expect(row).toEqual({ id: 'exec-1', tool: 'refund', status: 'succeeded', result: { ok: true } });
  });

  it('returns null when not found', async () => {
    q1Returns.push(null);
    expect(await getExecution('missing')).toBeNull();
  });
});
