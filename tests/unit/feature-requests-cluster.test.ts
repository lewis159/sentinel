import { describe, it, expect } from 'vitest';
import {
  clusterFeatureRequests,
  tokenize,
  stem,
  ageStringToMs,
  type Candidate,
} from '@/lib/feature-requests/cluster';

const DAY = 24 * 60 * 60 * 1000;

function cand(partial: Partial<Candidate> & { ref: string; title: string }): Candidate {
  return {
    summary: '',
    ageMs: 0,
    source: 'request',
    ...partial,
  };
}

describe('tokenize + stem', () => {
  it('strips stopwords/punctuation and folds plurals+tenses to one stem', () => {
    const a = tokenize('Add PDF exporting for transcripts');
    const b = tokenize('Please support exports as PDF');
    // "exporting" and "exports" both stem to "export".
    expect(a.stems).toContain(stem('exporting'));
    expect(b.stems).toContain(stem('exports'));
    expect(stem('exporting')).toBe(stem('exports'));
    // "pdf" survives as a signal token in both.
    expect(a.stems).toContain('pdf');
    expect(b.stems).toContain('pdf');
    // stopwords/noise ("add", "please", "support", "for", "as") are dropped.
    expect(a.stems).not.toContain('add');
    expect(b.stems).not.toContain('please');
    expect(b.stems).not.toContain('support');
  });
});

describe('ageStringToMs', () => {
  it('parses relative ages, defaulting unknowns to old', () => {
    expect(ageStringToMs('just now')).toBe(0);
    expect(ageStringToMs('30m')).toBe(30 * 60 * 1000);
    expect(ageStringToMs('3h')).toBe(3 * 60 * 60 * 1000);
    expect(ageStringToMs('2d')).toBe(2 * DAY);
    expect(ageStringToMs('—')).toBeGreaterThan(30 * DAY);
    expect(ageStringToMs(null)).toBeGreaterThan(30 * DAY);
  });
});

describe('clusterFeatureRequests — grouping by keyword overlap', () => {
  const items: Candidate[] = [
    cand({ ref: 'REQ-1', title: 'Add PDF export for transcripts', ageMs: 1 * DAY }),
    cand({ ref: 'REQ-2', title: 'Export transcript to PDF please', ageMs: 2 * DAY }),
    cand({ ref: 'REQ-3', title: 'PDF export button on the video page', ageMs: 3 * DAY }),
    cand({ ref: 'REQ-4', title: 'Single sign-on with Okta login', ageMs: 1 * DAY }),
    cand({ ref: 'REQ-5', title: 'SSO login support for enterprise', ageMs: 2 * DAY }),
  ];

  it('separates the export theme from the login theme', () => {
    const clusters = clusterFeatureRequests(items);
    // Two multi-item themes (export×3, login/sso×2).
    const multi = clusters.filter((c) => c.count > 1);
    expect(multi.length).toBe(2);

    const exportTheme = clusters.find((c) => c.examples.some((e) => e.ref === 'REQ-1'));
    const loginTheme = clusters.find((c) => c.examples.some((e) => e.ref === 'REQ-4'));

    expect(exportTheme?.count).toBe(3);
    expect(exportTheme?.examples.map((e) => e.ref).sort()).toEqual(['REQ-1', 'REQ-2', 'REQ-3']);

    expect(loginTheme?.count).toBe(2);
    expect(loginTheme?.examples.map((e) => e.ref).sort()).toEqual(['REQ-4', 'REQ-5']);

    // The export theme's keywords surface the shared signal.
    expect(exportTheme?.keywords).toContain('export');
  });

  it('keeps a singleton with no shared salient stem as its own theme', () => {
    const withLoner = [
      ...items,
      cand({ ref: 'REQ-6', title: 'Dark mode dashboard theme toggle', ageMs: 1 * DAY }),
    ];
    const clusters = clusterFeatureRequests(withLoner);
    const loner = clusters.find((c) => c.examples.some((e) => e.ref === 'REQ-6'));
    expect(loner).toBeDefined();
    expect(loner?.count).toBe(1);
  });

  it('is deterministic regardless of input order', () => {
    const a = clusterFeatureRequests(items);
    const b = clusterFeatureRequests([...items].reverse());
    expect(a.map((c) => [c.key, c.count])).toEqual(b.map((c) => [c.key, c.count]));
  });

  it('returns [] for no candidates', () => {
    expect(clusterFeatureRequests([])).toEqual([]);
  });
});

describe('clusterFeatureRequests — ranking by volume + recency', () => {
  it('ranks a larger theme above a smaller one', () => {
    const items: Candidate[] = [
      cand({ ref: 'A-1', title: 'billing invoice pdf', ageMs: 5 * DAY }),
      cand({ ref: 'A-2', title: 'billing invoice export', ageMs: 5 * DAY }),
      cand({ ref: 'A-3', title: 'billing invoice email', ageMs: 5 * DAY }),
      cand({ ref: 'B-1', title: 'calendar sync integration', ageMs: 5 * DAY }),
      cand({ ref: 'B-2', title: 'calendar sync feed', ageMs: 5 * DAY }),
    ];
    const clusters = clusterFeatureRequests(items);
    // Larger (billing×3) outranks smaller (calendar×2).
    expect(clusters[0].examples.some((e) => e.ref.startsWith('A'))).toBe(true);
    expect(clusters[0].count).toBe(3);
  });

  it('breaks an equal-size tie in favour of the fresher theme', () => {
    const items: Candidate[] = [
      // fresh pair
      cand({ ref: 'F-1', title: 'webhook retry backoff', ageMs: 0 }),
      cand({ ref: 'F-2', title: 'webhook retry policy', ageMs: 1 * DAY }),
      // stale pair
      cand({ ref: 'S-1', title: 'avatar upload cropping', ageMs: 60 * DAY }),
      cand({ ref: 'S-2', title: 'avatar upload resize', ageMs: 60 * DAY }),
    ];
    const clusters = clusterFeatureRequests(items);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].examples.some((e) => e.ref.startsWith('F'))).toBe(true);
    // Fresh theme scores higher than stale theme of equal size.
    expect(clusters[0].score).toBeGreaterThan(clusters[1].score);
  });
});

describe('clusterFeatureRequests — examples, trend, href, source', () => {
  it('caps examples and computes a rising trend when items are recent', () => {
    const items: Candidate[] = Array.from({ length: 6 }, (_, i) =>
      cand({ ref: `X-${i}`, title: `import bulk import csv upload ${i}`, ageMs: 1 * DAY }),
    );
    const clusters = clusterFeatureRequests(items, { maxExamples: 3 });
    const theme = clusters[0];
    expect(theme.count).toBe(6);
    expect(theme.examples.length).toBe(3); // capped
    expect(theme.trend).toBe('rising'); // all within recent window
    expect(theme.recentCount).toBe(6);
  });

  it('computes a cooling trend when items are old', () => {
    const items: Candidate[] = [
      cand({ ref: 'O-1', title: 'legacy api versioning', ageMs: 60 * DAY }),
      cand({ ref: 'O-2', title: 'legacy api deprecation', ageMs: 70 * DAY }),
      cand({ ref: 'O-3', title: 'legacy api sunset', ageMs: 80 * DAY }),
    ];
    const clusters = clusterFeatureRequests(items);
    expect(clusters[0].trend).toBe('cooling');
    expect(clusters[0].recentCount).toBe(0);
  });

  it('uses the provided hrefFor and preserves the source on examples', () => {
    const items: Candidate[] = [
      cand({ ref: 'REQ-9', title: 'search filters facets', ageMs: 0, source: 'request' }),
      cand({ ref: 'FB-9', title: 'search filters facets', ageMs: 0, source: 'feedback' }),
    ];
    const clusters = clusterFeatureRequests(items, {
      hrefFor: (c) => `/custom/${c.ref}`,
    });
    const theme = clusters[0];
    expect(theme.examples.every((e) => e.href.startsWith('/custom/'))).toBe(true);
    const sources = theme.examples.map((e) => e.source).sort();
    expect(sources).toEqual(['feedback', 'request']);
  });
});
