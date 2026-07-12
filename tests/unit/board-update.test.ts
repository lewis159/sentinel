import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Board / Founder-Update prep — assembler roll-up, "no data" degradation,
// brain-off deterministic template (no model call), and save→proposal wiring.
//
// The assembler's data access is INJECTED, so the roll-up tests pass mock
// roadmap/tickets/spine directly. We still mock the server-only heavy modules so
// importing the lib in the node test env doesn't drag in the DB/Stripe/secrets.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => ({
  callModel: vi.fn(async () => ({ ok: true, content: 'AI summary prose.', toolCalls: [], model: 'test-model' })),
  saveProposal: vi.fn(async () => 'prop-1'),
}));

vi.mock('server-only', () => ({}));

// Heavy default deps — mocked so import doesn't touch DB/secrets. The assembler
// tests inject their own deps, so these stubs are only import-time guards.
vi.mock('@/lib/data', () => ({
  getRoadmap: vi.fn(async () => ({ rows: [], live: false })),
  getTickets: vi.fn(async () => ({ rows: [], live: false })),
  getTicketsByKind: vi.fn(async () => ({ rows: [], live: false })),
  getChangelog: vi.fn(async () => ({ rows: [], live: false })),
}));
vi.mock('@/lib/uptime', () => ({ getUptimeStatus: vi.fn(async () => ({ monitors: [], ok: false })) }));
vi.mock('@/lib/board-update/revenue', () => ({
  readRevenue: vi.fn(async () => ({
    mrr: { available: false, display: 'No data', source: 's', todo: 't' },
    newRevenue: { available: false, display: 'No data', source: 's', todo: 't' },
    churn: { available: false, display: 'No data', source: 's', todo: 't' },
    runway: { available: false, display: 'No data', source: 's', todo: 't' },
  })),
}));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: H.callModel }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal }));

import { assembleBoardUpdate, type AssembleDeps } from '@/lib/board-update/assemble';
import { buildDraft, renderTemplate, saveBoardUpdateDraft } from '@/lib/board-update/draft';

const NOW = new Date('2026-07-15T00:00:00Z');

const noDataMetric = (todo: string) => ({ available: false as const, display: 'No data', source: 's', todo });
const revNoData = async () => ({
  mrr: noDataMetric('mrr todo'),
  newRevenue: { available: true as const, display: '£1,000.00', value: 100000, currency: 'gbp', source: 'Stripe /charges' },
  churn: noDataMetric('churn todo'),
  runway: noDataMetric('runway todo'),
});

function fullDeps(): AssembleDeps {
  return {
    getRoadmap: async () => ({
      rows: [
        { itemKey: 'RM-1', title: 'Shipped feature', description: '', status: 'shipped', app: 'Sentinel', sortOrder: 1 },
        { itemKey: 'RM-2', title: 'WIP feature', description: '', status: 'in_progress', app: 'YT', sortOrder: 2 },
        { itemKey: 'RM-3', title: 'Review feature', description: '', status: 'in_review', app: 'YT', sortOrder: 3 },
        { itemKey: 'RM-4', title: 'Backlog feature', description: '', status: 'backlog', app: 'Estate', sortOrder: 4 },
      ],
      live: true,
    }),
    getTickets: async () => ({
      rows: [
        { ref: 'T-1', title: 'a', type: 'task', status: 'resolved', priority: 'low', assignee: '-', source: 'm', age: '1d' },
        { ref: 'T-2', title: 'b', type: 'task', status: 'open', priority: 'low', assignee: '-', source: 'm', age: '1d' },
        { ref: 'T-3', title: 'c', type: 'task', status: 'in_progress', priority: 'low', assignee: '-', source: 'm', age: '1d' },
      ],
      live: true,
    }),
    getIncidents: async () => ({
      rows: [
        { ref: 'INC-1', status: 'resolved', slaDue: null } as any,
        { ref: 'INC-2', status: 'open', slaDue: '2026-07-10T00:00:00Z' } as any, // past → breach
      ],
      live: true,
    }),
    getChangelog: async () => ({
      rows: [
        { version: 'v1.0', label: 'GA', date: NOW.toISOString(), body: '', app: 'Sentinel' },
        { version: 'v0.1', label: 'old', date: '2026-01-01T00:00:00Z', body: '', app: 'Sentinel' }, // out of period
      ],
      live: true,
    }),
    getUptime: async () => ({ monitors: [{ name: 'a', up: true }, { name: 'b', up: false }], ok: true }),
    readRevenue: revNoData,
  };
}

beforeEach(() => {
  H.callModel.mockClear();
  H.saveProposal.mockClear();
  delete process.env.HERMES_BRAIN_ENABLED;
});

describe('assembleBoardUpdate roll-up', () => {
  it('splits roadmap into shipped / in-flight and derives support/ops/wins', async () => {
    const u = await assembleBoardUpdate({ now: NOW, deps: fullDeps() });

    expect(u.period).toBe('July 2026');

    // Roadmap: 1 shipped, 2 in-flight (in_progress + in_review); backlog excluded.
    expect(u.roadmap.shipped.map((s) => s.key)).toEqual(['RM-1']);
    expect(u.roadmap.inFlight.map((s) => s.key)).toEqual(['RM-2', 'RM-3']);
    expect(u.roadmap.hasData).toBe(true);

    // Support: 3 tickets, 1 resolved, 2 open, 1 SLA breach (from the past-due incident).
    expect(u.support.ticketVolume).toBe(3);
    expect(u.support.resolved).toBe(1);
    expect(u.support.open).toBe(2);
    expect(u.support.slaBreaches).toBe(1);

    // Ops: 2 incidents, 1 resolved, uptime 50%.
    expect(u.ops.incidents).toBe(2);
    expect(u.ops.incidentsResolved).toBe(1);
    expect(u.ops.uptime.available).toBe(true);
    expect(u.ops.uptime.value).toBeCloseTo(50);

    // Wins: shipped item + in-period changelog + resolved incident. NOT the
    // out-of-period changelog entry.
    expect(u.wins.items).toContain('Shipped: Shipped feature (Sentinel)');
    expect(u.wins.items).toContain('Released v1.0 — GA');
    expect(u.wins.items).toContain('Resolved 1 incident');
    expect(u.wins.items.some((w) => w.includes('v0.1'))).toBe(false);
    expect(u.wins.hasData).toBe(true);

    // Revenue: newRevenue populated; MRR/churn/runway are honest "no data" + TODO.
    expect(u.metrics.newRevenue.available).toBe(true);
    expect(u.metrics.mrr.available).toBe(false);
    expect(u.metrics.mrr.todo).toBeTruthy();
  });

  it('marks every empty section "no data" and never fabricates', async () => {
    const empty: AssembleDeps = {
      getRoadmap: async () => ({ rows: [], live: false }),
      getTickets: async () => ({ rows: [], live: false }),
      getIncidents: async () => ({ rows: [], live: false }),
      getChangelog: async () => ({ rows: [], live: false }),
      getUptime: async () => ({ monitors: [], ok: false, note: 'not configured' }),
      readRevenue: async () => ({
        mrr: noDataMetric('mrr todo'),
        newRevenue: noDataMetric('rev todo'),
        churn: noDataMetric('churn todo'),
        runway: noDataMetric('runway todo'),
      }),
    };
    const u = await assembleBoardUpdate({ now: NOW, deps: empty });

    expect(u.roadmap.hasData).toBe(false);
    expect(u.support.hasData).toBe(false);
    expect(u.ops.hasData).toBe(false);
    expect(u.wins.hasData).toBe(false);
    expect(u.ops.uptime.available).toBe(false);

    // The rendered draft surfaces "no data", not invented figures.
    const md = renderTemplate(u);
    expect(md).toMatch(/_no data_/i);
    expect(md).not.toMatch(/£\d/); // no fabricated money
  });
});

describe('buildDraft', () => {
  it('brain OFF → deterministic template, NO model call', async () => {
    const u = await assembleBoardUpdate({ now: NOW, deps: fullDeps() });
    const draft = await buildDraft(u);

    expect(draft.mode).toBe('template');
    expect(H.callModel).not.toHaveBeenCalled();
    expect(draft.markdown).toContain('# Board update — July 2026');
    expect(draft.markdown).toContain('## Headline metrics');
    expect(draft.markdown).toContain('## What shipped');
    expect(draft.markdown).toContain('## Wins');
  });

  it('noLlm option forces the template even if the flag were on', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const u = await assembleBoardUpdate({ now: NOW, deps: fullDeps() });
    const draft = await buildDraft(u, { noLlm: true });
    expect(draft.mode).toBe('template');
    expect(H.callModel).not.toHaveBeenCalled();
  });
});

describe('saveBoardUpdateDraft', () => {
  it('persists as kind "board-update" carrying the markdown, draft-only', async () => {
    const u = await assembleBoardUpdate({ now: NOW, deps: fullDeps() });
    const md = renderTemplate(u);
    const id = await saveBoardUpdateDraft(u, md);

    expect(id).toBe('prop-1');
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = H.saveProposal.mock.calls[0][0] as any;
    expect(arg.kind).toBe('board-update');
    expect(arg.proposal.draft).toBe(md);
    expect(arg.title).toContain('July 2026');
    // No action spine → nothing auto-executes/sends.
    expect(arg.proposal.action).toBeUndefined();
  });
});
