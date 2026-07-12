import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// P3 — "Needs human" support queue: pure ranking + labelling logic
// (lib/support/needs-human-sort.ts). No DB, no server-only — imported directly.
// The server assembler (needs-human-view.ts) is thin glue over these; the sort
// order and the "why it's here" reason are the testable substance.
// ---------------------------------------------------------------------------

import {
  ageToSeconds,
  urgencyScore,
  priorityPill,
  reasonForNeedsHuman,
  sortByUrgency,
} from '@/lib/support/needs-human-sort';

describe('ageToSeconds', () => {
  it('parses the data-layer age strings', () => {
    expect(ageToSeconds('40s')).toBe(40);
    expect(ageToSeconds('14m')).toBe(14 * 60);
    expect(ageToSeconds('3h')).toBe(3 * 3600);
    expect(ageToSeconds('2d')).toBe(2 * 86400);
    expect(ageToSeconds('1w')).toBe(604800);
  });

  it('treats "just now" / unparseable / empty as brand-new (0s)', () => {
    expect(ageToSeconds('just now')).toBe(0);
    expect(ageToSeconds('—')).toBe(0);
    expect(ageToSeconds('')).toBe(0);
    expect(ageToSeconds(null)).toBe(0);
    expect(ageToSeconds(undefined)).toBe(0);
  });
});

describe('urgencyScore — priority dominates, age breaks ties', () => {
  it('any higher priority outranks a lower one regardless of age', () => {
    // A brand-new critical still outranks a week-old high.
    expect(urgencyScore('critical', 0)).toBeGreaterThan(urgencyScore('high', ageToSeconds('7d')));
    expect(urgencyScore('high', 0)).toBeGreaterThan(urgencyScore('medium', 999999));
  });

  it('within the same priority, older is more urgent', () => {
    expect(urgencyScore('high', ageToSeconds('3d'))).toBeGreaterThan(
      urgencyScore('high', ageToSeconds('1h')),
    );
  });
});

describe('sortByUrgency', () => {
  const row = (ref: string, priority: string, age: string) => ({
    ref,
    urgency: urgencyScore(priority, ageToSeconds(age)),
  });

  it('orders most-urgent first (priority, then age)', () => {
    const rows = [
      row('A-low', 'low', '5d'),
      row('B-crit-new', 'critical', '2h'),
      row('C-high-old', 'high', '4d'),
      row('D-high-new', 'high', '1h'),
      row('E-med', 'medium', '10h'),
    ];
    const order = sortByUrgency(rows).map((r) => r.ref);
    expect(order).toEqual(['B-crit-new', 'C-high-old', 'D-high-new', 'E-med', 'A-low']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('X', 'low', '1h'), row('Y', 'critical', '1h')];
    const before = rows.map((r) => r.ref);
    sortByUrgency(rows);
    expect(rows.map((r) => r.ref)).toEqual(before);
  });

  it('is stable by ref for equal urgency', () => {
    const rows = [row('B', 'high', '1h'), row('A', 'high', '1h')];
    expect(sortByUrgency(rows).map((r) => r.ref)).toEqual(['A', 'B']);
  });
});

describe('priorityPill', () => {
  it('maps severities to the shared pill classes', () => {
    expect(priorityPill('critical')).toEqual({ cls: 'crit', label: 'Critical' });
    expect(priorityPill('high')).toEqual({ cls: 'high', label: 'High' });
    expect(priorityPill('medium')).toEqual({ cls: 'info', label: 'Medium' });
    expect(priorityPill('low')).toEqual({ cls: 'info', label: 'Low' });
  });

  it('falls back gracefully for an unknown priority', () => {
    expect(priorityPill('')).toEqual({ cls: 'info', label: 'Normal' });
    expect(priorityPill('weird')).toEqual({ cls: 'info', label: 'Weird' });
  });
});

describe('reasonForNeedsHuman', () => {
  it('prefers the intake flag and maps escalated_via to a human reason', () => {
    expect(reasonForNeedsHuman({ needs_human: true, escalated_via: 'low_confidence' }, 'l1')).toEqual({
      reason: 'AI answer was low-confidence',
      flaggedByIntake: true,
    });
    expect(reasonForNeedsHuman({ needs_human: true, escalated_via: 'unanswered' }, 'l1').reason).toBe(
      'AI could not answer',
    );
    expect(reasonForNeedsHuman({ needs_human: true, escalated_via: 'customer' }, 'l1').reason).toBe(
      'Customer asked for a human',
    );
  });

  it('accepts a stringified needs_human flag and an unknown via', () => {
    const r = reasonForNeedsHuman({ needs_human: 'true', escalated_via: 'mystery' }, 'l1');
    expect(r.flaggedByIntake).toBe(true);
    expect(r.reason).toBe('Flagged for a human by intake');
  });

  it('falls back to the ladder escalation when not intake-flagged', () => {
    expect(reasonForNeedsHuman({ escalation_level: 'human' }, 'human')).toEqual({
      reason: 'Escalated to the human gate',
      flaggedByIntake: false,
    });
  });

  it('has a safe default for an empty/absent attrs bag', () => {
    expect(reasonForNeedsHuman({}, 'l1')).toEqual({ reason: 'Needs a human', flaggedByIntake: false });
    expect(reasonForNeedsHuman(null, 'l1').reason).toBe('Needs a human');
  });
});
