import { describe, it, expect, vi, beforeEach } from 'vitest';

// autonomy.ts is server-only and DB-backed. Stub both so we can unit-test the
// governance keystone: that a stored dial value OVERRIDES the tool's static
// default — i.e. flipping a dial changes whether the Brain gates a tool.
vi.mock('server-only', () => ({}));

// Mutable fake of the autonomy_config table the mocked db reads from.
let rows: { persona: string; tool: string; mode: string }[] = [];
let dbPresent = true;

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return dbPresent;
  },
  q: vi.fn(async (text: string) => {
    // Only the SELECT of overrides matters for resolveAutonomy(); DDL is a no-op.
    if (/select\s+persona,\s*tool,\s*mode\s+from\s+hermes\.autonomy_config/i.test(text)) {
      return rows;
    }
    return [];
  }),
}));

import { resolveAutonomy } from '@/lib/hermes/brain/autonomy';

beforeEach(() => {
  rows = [];
  dbPresent = true;
});

describe('resolveAutonomy — the dial gates the tool', () => {
  it('uses the tool default when no dial is stored', async () => {
    // No row for (pa, updateTicket) → falls back to the static default 'gated'.
    expect(await resolveAutonomy('pa', 'updateTicket', 'gated')).toBe('gated');
  });

  it('a stored dial OVERRIDES the default (gated → auto stops the interrupt)', async () => {
    rows = [{ persona: 'pa', tool: 'updateTicket', mode: 'auto' }];
    // The very same call the graph makes: fallback 'gated', but the DB says auto.
    expect(await resolveAutonomy('pa', 'updateTicket', 'gated')).toBe('auto');
  });

  it('a stored dial can TIGHTEN a safe tool to draft_only', async () => {
    rows = [{ persona: 'support', tool: 'getTicket', mode: 'draft_only' }];
    expect(await resolveAutonomy('support', 'getTicket', 'auto')).toBe('draft_only');
  });

  it('falls back to the static default with no database', async () => {
    dbPresent = false;
    expect(await resolveAutonomy('pa', 'updateTicket', 'gated')).toBe('gated');
  });
});
