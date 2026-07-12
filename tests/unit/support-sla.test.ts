import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Support desk SLA policy + timer maths (lib/support/sla.ts). Pure logic — no
// DB, no clock singletons (now is injected). Covers:
//   1. slaTargetFor — target selection per priority (+ per-kind factor).
//   2. computeSla — ok / due-soon / breached at boundary times.
//   3. a breached OPEN ticket flags (breachedOpen), a breached CLOSED one does not.
//   4. badge label/class presentation helpers.
// ---------------------------------------------------------------------------

import {
  slaTargetFor,
  computeSla,
  slaBadgeClass,
  slaBadgeLabel,
  formatDuration,
} from '@/lib/support/sla';

const MIN = 60_000;
const HOUR = 60 * MIN;

// A fixed reference "now" so every case is deterministic.
const NOW = Date.parse('2026-07-12T12:00:00.000Z');

describe('slaTargetFor — target selection per priority', () => {
  it('tightens the resolution target as priority rises (incident baseline)', () => {
    expect(slaTargetFor('critical', 'incident').resolutionMs).toBe(4 * HOUR);
    expect(slaTargetFor('high', 'incident').resolutionMs).toBe(8 * HOUR);
    expect(slaTargetFor('medium', 'incident').resolutionMs).toBe(24 * HOUR);
    expect(slaTargetFor('low', 'incident').resolutionMs).toBe(48 * HOUR);
    expect(slaTargetFor('info', 'incident').resolutionMs).toBe(72 * HOUR);
  });

  it('sets a shorter response target than resolution', () => {
    const crit = slaTargetFor('critical', 'incident');
    expect(crit.responseMs).toBe(15 * MIN);
    expect(crit.responseMs).toBeLessThan(crit.resolutionMs);
  });

  it('applies the per-kind factor (changes are 3× an incident)', () => {
    const inc = slaTargetFor('high', 'incident').resolutionMs;
    const chg = slaTargetFor('high', 'change').resolutionMs;
    const req = slaTargetFor('high', 'request').resolutionMs;
    expect(chg).toBe(inc * 3);
    expect(req).toBe(inc * 1.5);
  });

  it('falls back to the medium baseline for unknown/blank priority', () => {
    expect(slaTargetFor(undefined, 'incident').resolutionMs).toBe(24 * HOUR);
    expect(slaTargetFor('nonsense', 'incident').resolutionMs).toBe(24 * HOUR);
  });
});

describe('computeSla — states at boundary times', () => {
  // A high-priority incident: resolution target = 8h, due-soon window = 25% = 2h.
  const target = 8 * HOUR;
  const dueSoon = target * 0.25; // 2h

  it('is "ok" when comfortably within the window', () => {
    const dueAt = new Date(NOW + 6 * HOUR).toISOString(); // 6h left > 2h window
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('ok');
    expect(r.remainingMs).toBe(6 * HOUR);
    expect(r.breachedOpen).toBe(false);
  });

  it('is "due-soon" exactly at the due-soon boundary', () => {
    const dueAt = new Date(NOW + dueSoon).toISOString(); // remaining == window
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('due-soon');
    expect(r.breachedOpen).toBe(false);
  });

  it('is "ok" just past the due-soon boundary', () => {
    const dueAt = new Date(NOW + dueSoon + MIN).toISOString(); // 1min more than window
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('ok');
  });

  it('is "due-soon" just before the deadline', () => {
    const dueAt = new Date(NOW + MIN).toISOString();
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('due-soon');
  });

  it('is "breached" exactly at the deadline (remaining == 0)', () => {
    const dueAt = new Date(NOW).toISOString();
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('breached');
    expect(r.remainingMs).toBe(0);
    expect(r.breachedOpen).toBe(true);
  });

  it('is "breached" once past the deadline (negative remaining)', () => {
    const dueAt = new Date(NOW - 22 * MIN).toISOString();
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: dueAt }, NOW);
    expect(r.state).toBe('breached');
    expect(r.remainingMs).toBe(-22 * MIN);
    expect(r.breachedOpen).toBe(true);
  });
});

describe('computeSla — breached open flags; closed does not', () => {
  const past = new Date(NOW - HOUR).toISOString();

  it('flags a breached OPEN ticket for the human queue', () => {
    const r = computeSla({ priority: 'critical', kind: 'incident', status: 'in_progress', slaDue: past }, NOW);
    expect(r.state).toBe('breached');
    expect(r.breachedOpen).toBe(true);
  });

  it('does NOT flag a breached but CLOSED/resolved ticket (clock stopped)', () => {
    for (const status of ['resolved', 'closed', 'fulfilled', 'implemented', 'cancelled']) {
      const r = computeSla({ priority: 'critical', kind: 'incident', status, slaDue: past }, NOW);
      expect(r.state).toBe('ok');
      expect(r.breachedOpen).toBe(false);
    }
  });
});

describe('computeSla — deadline derivation without an explicit slaDue', () => {
  it('derives the deadline from created_at + policy target', () => {
    const createdAt = new Date(NOW - 2 * HOUR).toISOString();
    // high incident target 8h → due 6h from NOW → ok.
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open', createdAt }, NOW);
    expect(r.dueAt).toBe(new Date(NOW + 6 * HOUR).toISOString());
    expect(r.state).toBe('ok');
  });

  it('derives from a relative age string when that is all it has (mock-safe)', () => {
    // low incident target 48h, age 50h → deadline 2h in the PAST → breached.
    const r = computeSla({ priority: 'low', kind: 'incident', status: 'open', age: '50h' }, NOW);
    expect(r.state).toBe('breached');
    expect(r.breachedOpen).toBe(true);
  });

  it('returns no-SLA (null) when it cannot determine a deadline', () => {
    const r = computeSla({ priority: 'high', kind: 'incident', status: 'open' }, NOW);
    expect(r.dueAt).toBeNull();
    expect(r.remainingMs).toBeNull();
    expect(r.state).toBe('ok');
    expect(r.breachedOpen).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('maps SLA state → existing badge CSS variant', () => {
    expect(slaBadgeClass('ok')).toBe('ok');
    expect(slaBadgeClass('due-soon')).toBe('warn');
    expect(slaBadgeClass('breached')).toBe('breach');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(45 * MIN)).toBe('45m');
    expect(formatDuration(2 * HOUR + 5 * MIN)).toBe('2h 5m');
    expect(formatDuration(26 * HOUR)).toBe('1d 2h');
  });

  it('labels ok / due-soon / breached / no-SLA', () => {
    expect(slaBadgeLabel(computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: new Date(NOW + 6 * HOUR).toISOString() }, NOW))).toBe('6h left');
    expect(slaBadgeLabel(computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: new Date(NOW + MIN).toISOString() }, NOW))).toContain('due soon');
    expect(slaBadgeLabel(computeSla({ priority: 'high', kind: 'incident', status: 'open', slaDue: new Date(NOW - 22 * MIN).toISOString() }, NOW))).toContain('BREACHED');
    expect(slaBadgeLabel(computeSla({ priority: 'high', kind: 'incident', status: 'open' }, NOW))).toBe('no SLA');
  });
});
