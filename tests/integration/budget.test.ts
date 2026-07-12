import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NODB, hasDbUrl, SKIP_MESSAGE } from './_helpers';

// ---------------------------------------------------------------------------
// BUDGET — checkBudget/recordSpend enforce a seeded cap across the REAL ledger.
//
// lib/hermes/budget.ts is exercised against real ops.hermes_budgets +
// ops.hermes_budget_ledger: we seed a (persona, tool='*', scope) cap, then prove
// the window-summed spend gate flips allowed→false at the cap boundary.
// ---------------------------------------------------------------------------

// Imported for real (DATABASE_URL drives hasDb inside lib/db).
import { checkBudget, recordSpend } from '@/lib/hermes/budget';
import { q } from '@/lib/db';

const PERSONA = `itest_budget_${Date.now()}`;
const SCOPE = 'itest';

if (NODB) {
  // eslint-disable-next-line no-console
  console.log(`[budget.test] ${SKIP_MESSAGE}`);
}

describe.runIf(NODB)('budget (skipped, no DATABASE_URL)', () => {
  it('no DB — skipped', () => {
    expect(hasDbUrl).toBe(false);
  });
});

describe.skipIf(NODB)('BUDGET: caps enforced across the real ledger', () => {
  beforeAll(async () => {
    // Seed a £10.00 (1000 pennies) persona-wide daily cap for this scope.
    await q(
      `insert into ops.hermes_budgets (persona, tool, scope, cap_minor, window_seconds)
       values ($1, '*', $2, 1000, 86400)
       on conflict (persona, tool, scope) do update set cap_minor = excluded.cap_minor`,
      [PERSONA, SCOPE],
    );
    // Clean any stray ledger rows for this persona/scope from a prior run.
    await q(`delete from ops.hermes_budget_ledger where persona = $1 and scope = $2`, [PERSONA, SCOPE]);
  });

  afterAll(async () => {
    await q(`delete from ops.hermes_budget_ledger where persona = $1 and scope = $2`, [PERSONA, SCOPE]);
    await q(`delete from ops.hermes_budgets where persona = $1 and scope = $2`, [PERSONA, SCOPE]);
  });

  it('resolves the seeded cap and allows a spend under it', async () => {
    const d = await checkBudget(PERSONA, 'refund', 600, SCOPE);
    expect(d.uncapped).toBe(false);
    expect(d.capMinor).toBe(1000);
    expect(d.spentMinor).toBe(0);
    expect(d.allowed).toBe(true);
    // The persona-wide cap matched via its '*' grain.
    expect(d.tool).toBe('*');
  });

  it('a recorded spend counts against the window and blocks a breach', async () => {
    await recordSpend(PERSONA, 'refund', 600, { scope: SCOPE });

    // 600 already spent; +600 => 1200 > 1000 cap → denied.
    const over = await checkBudget(PERSONA, 'refund', 600, SCOPE);
    expect(over.spentMinor).toBe(600);
    expect(over.allowed).toBe(false);
    expect(over.remainingMinor).toBe(400);
    expect(over.reason).toMatch(/cap 1000 would be exceeded/i);

    // +400 exactly reaches the cap → still allowed (<=).
    const atCap = await checkBudget(PERSONA, 'refund', 400, SCOPE);
    expect(atCap.allowed).toBe(true);
  });

  it('a persona with no configured cap is uncapped (allowed)', async () => {
    const d = await checkBudget(`${PERSONA}_none`, 'refund', 999999, SCOPE);
    expect(d.uncapped).toBe(true);
    expect(d.allowed).toBe(true);
    expect(d.capMinor).toBeNull();
  });
});
