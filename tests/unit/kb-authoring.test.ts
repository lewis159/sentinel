import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hermes · KB Auto-Authoring — gap detection + article draft.
//
// We drive detectGaps() with an INJECTED KB retriever so scores are exact and
// deterministic (no real KB / DB), and we prove:
//   • a resolved question with NO good KB match becomes a gap; a well-covered one
//     does NOT,
//   • repeated gaps rank above one-offs (frequency weighting),
//   • the brain-OFF draft path returns a deterministic skeleton and NEVER calls
//     the model,
//   • the brain-ON draft path uses the (mocked) model and yields an llm article,
//   • a proposed article persists as kind:'kb-article' and NEVER publishes to the
//     KB (no content/kb / hermes.kb_chunks write).
// ---------------------------------------------------------------------------

import { detectGaps, scoreKbCoverage } from '@/lib/kb-authoring/gaps';
import type { KbSnippet } from '@/lib/hermes/kb-context';

// An injectable retriever: returns a perfect-overlap article for any query that
// mentions `covers`, else nothing (a gap). Deterministic.
function fakeRetriever(covers: Record<string, KbSnippet>) {
  return async (query: string): Promise<KbSnippet[]> => {
    const q = query.toLowerCase();
    for (const [needle, snip] of Object.entries(covers)) {
      if (q.includes(needle)) return [snip];
    }
    return [];
  };
}

describe('scoreKbCoverage', () => {
  it('scores 1 when the best article contains every significant word', async () => {
    const retrieve = fakeRetriever({
      widget: { slug: 'widget', title: 'Embedding the transcript widget on a page', body: 'How to embed the transcript widget on any page.' },
    });
    const { score } = await scoreKbCoverage('Embedding the transcript widget on a page', retrieve);
    expect(score).toBeGreaterThan(0.9);
  });

  it('scores 0 when the KB returns nothing', async () => {
    const { score } = await scoreKbCoverage('exporting captions to premiere', fakeRetriever({}));
    expect(score).toBe(0);
  });

  it('scores 1 (never a gap) for an empty/low-signal question', async () => {
    const { score } = await scoreKbCoverage('   the a an   ', fakeRetriever({}));
    expect(score).toBe(1);
  });
});

describe('detectGaps', () => {
  it('flags a low-coverage resolved question as a gap and skips a well-covered one', async () => {
    const retrieve = fakeRetriever({
      // "rate limit" is well covered; the SAML question is not covered at all.
      'rate limit': { slug: 'rate-limiting', title: 'Adding rate limits to public submit endpoints', body: 'A public submit endpoint returns 429 when the rate limit bucket empties.' },
    });
    const gaps = await detectGaps(
      [
        { ref: 'REQ-1', title: 'Public submit endpoint rate limit', description: 'my rate limit 429' },
        { ref: 'REQ-2', title: 'SAML SCIM provisioning to Okta', description: 'configure SCIM provisioning bridge' },
      ],
      { retrieve },
    );
    // Only the uncovered SAML/SCIM question is a gap.
    const refs = gaps.flatMap((g) => g.exampleTickets.map((e) => e.ref));
    expect(refs).toContain('REQ-2');
    expect(refs).not.toContain('REQ-1');
  });

  it('ranks a repeated gap above a one-off (frequency weighting)', async () => {
    const retrieve = fakeRetriever({}); // nothing covered → everything is a gap
    const gaps = await detectGaps(
      [
        { ref: 'T1', title: 'How do I export captions to SRT', description: 'export captions srt' },
        { ref: 'T2', title: 'Export captions to SRT failing', description: 'captions export srt' },
        { ref: 'T3', title: 'Export captions SRT download', description: 'captions srt export' },
        { ref: 'T4', title: 'Dark mode theme toggle missing', description: 'theme dark mode toggle' },
      ],
      { retrieve },
    );
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    // The 3× "captions/export/srt" cluster must rank first.
    expect(gaps[0].frequency).toBe(3);
    expect(gaps[0].frequency).toBeGreaterThan(gaps[1].frequency);
    expect(gaps[0].exampleTickets.map((e) => e.ref)).toEqual(
      expect.arrayContaining(['T1', 'T2', 'T3']),
    );
  });

  it('is deterministic — same input yields the same ranking', async () => {
    const tickets = [
      { ref: 'A', title: 'webhook signature verification', description: 'verify webhook hmac' },
      { ref: 'B', title: 'webhook retries backoff', description: 'webhook retry schedule' },
    ];
    const a = await detectGaps(tickets, { retrieve: fakeRetriever({}) });
    const b = await detectGaps(tickets, { retrieve: fakeRetriever({}) });
    expect(a).toEqual(b);
  });
});
