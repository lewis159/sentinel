// Hermes · KB Auto-Authoring — GAP DETECTION (pure / mock-safe).
//
// The support flywheel: when a customer question is resolved but the knowledge
// base has no good article for it, that's a *gap*. Filling gaps is what makes
// L0/L1 (and the copilots that ground on the KB) smarter over time.
//
// This module is DETERMINISTIC and dependency-light: given a set of resolved
// tickets plus a KB retriever, it scores each ticket's question against the KB,
// flags the low-scoring ones as gaps, clusters them by theme, and returns a
// frequency-weighted ranked list. It NEVER calls an LLM and NEVER writes
// anything — it only reads. The retriever defaults to retrieveKb (lexical by
// default, so it works with no DB / no embeddings key), but is injectable so the
// unit tests can drive exact scores.
//
// Nothing here is gated by HERMES_BRAIN_ENABLED: gap detection is a plain
// analytic that must work whether or not the Brain is on. The LLM only enters in
// draft.ts, and only to author an article body a human still has to approve.

import { retrieveKb, type KbSnippet } from '@/lib/hermes/kb-context';

// A resolved ticket reduced to what gap detection needs. Kept minimal so callers
// can pass ServiceTickets (or mocks) without coupling to the full row shape.
export type ResolvedTicketLike = {
  ref: string;
  title: string;
  description?: string | null;
};

export type GapExample = {
  ref: string;
  title: string;
  question: string;
  /** Best existing KB match score for THIS ticket, 0..1 (higher = closer). */
  score: number;
};

export type KbGap = {
  /** Salient keyword that names the cluster, e.g. "webhook" or "invoice". */
  theme: string;
  /** A ready-to-edit article title, seeded from a representative ticket. */
  suggestedTitle: string;
  /** How many resolved tickets fell into this gap (drives ranking). */
  frequency: number;
  /**
   * Closest any existing KB article got to any ticket in this cluster, 0..1.
   * A low number means the KB barely covers the theme — a strong gap signal.
   */
  bestKbScore: number;
  /** Up to `maxExamples` tickets that exemplify the gap (link targets in the UI). */
  exampleTickets: GapExample[];
};

export type DetectGapsOptions = {
  /**
   * A question whose best KB match scores at/above this (0..1) is considered
   * adequately covered and is NOT a gap. Default 0.34 — i.e. fewer than ~a third
   * of the question's significant words appear in the closest article.
   */
  threshold?: number;
  /** Max example tickets carried per gap. Default 5. */
  maxExamples?: number;
  /** Injectable KB retriever (defaults to the shared retrieveKb). */
  retrieve?: (query: string, limit?: number) => Promise<KbSnippet[]>;
};

// English stopwords + low-signal support terms. Mirrors kb-context's list (kept
// local so this module stays self-contained and independently testable).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'up', 'as',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he',
  'she', 'my', 'our', 'your', 'their', 'me', 'us', 'them', 'not', 'no', 'so',
  'if', 'then', 'than', 'can', 'cannot', 'cant', 'will', 'wont', 'would', 'could',
  'should', 'do', 'does', 'did', 'have', 'has', 'had', 'get', 'got', 'about',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'please', 'help', 'hi',
  'hello', 'thanks', 'thank', 'im', 'ive', 'am', 'any', 'all', 'some', 'just',
  'now', 'out', 'off', 'there', 'here', 'into', 'over', 'more', 'need', 'want',
  'unable', 'cant', 'wont', 'doesnt', 'isnt', 'error', 'issue', 'problem',
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function uniq(words: string[]): string[] {
  return Array.from(new Set(words));
}

// The most salient keywords of a question: significant words ranked by length
// (longer terms are more topical), then alphabetically for a stable tie-break.
function topKeywords(text: string, n: number): string[] {
  return uniq(significantWords(text))
    .sort((a, b) => (b.length - a.length) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, n);
}

/**
 * Score how well the CURRENT KB covers a question, 0..1.
 *   1  → the closest article contains every significant word of the question.
 *   0  → the KB returned nothing (or the question shares no word with the best).
 * Empty/low-signal questions score 1 (nothing to author — never a gap).
 */
export async function scoreKbCoverage(
  question: string,
  retrieve: (query: string, limit?: number) => Promise<KbSnippet[]>,
): Promise<{ score: number; best: KbSnippet | null }> {
  const q = uniq(significantWords(question));
  if (q.length === 0) return { score: 1, best: null };

  let hits: KbSnippet[] = [];
  try {
    hits = await retrieve(question, 1);
  } catch {
    hits = [];
  }
  if (!hits || hits.length === 0) return { score: 0, best: null };

  const best = hits[0];
  const articleWords = new Set(significantWords(`${best.title} ${best.body}`));
  let shared = 0;
  for (const w of q) if (articleWords.has(w)) shared += 1;
  return { score: shared / q.length, best };
}

/**
 * Detect KB gaps across a set of resolved tickets and return a frequency-weighted
 * ranked list of themes to write about.
 *
 * Deterministic given a fixed ticket order + retriever. Ranking: most frequent
 * gap first; ties broken by the WORST existing coverage (lowest bestKbScore),
 * then theme name — so a repeated, badly-covered question always rises to the top.
 */
export async function detectGaps(
  tickets: ResolvedTicketLike[],
  opts: DetectGapsOptions = {},
): Promise<KbGap[]> {
  const threshold = opts.threshold ?? 0.34;
  const maxExamples = opts.maxExamples ?? 5;
  const retrieve = opts.retrieve ?? retrieveKb;

  // 1) Score every ticket; keep the ones the KB fails to cover.
  type GapItem = GapExample & { keywords: string[] };
  const gapItems: GapItem[] = [];
  for (const t of tickets) {
    const question = `${t.title ?? ''} ${t.description ?? ''}`.trim();
    const { score } = await scoreKbCoverage(question, retrieve);
    if (score < threshold) {
      gapItems.push({
        ref: t.ref,
        title: t.title ?? t.ref,
        question,
        score,
        keywords: topKeywords(question, 3),
      });
    }
  }

  // 2) Greedy keyword clustering — a gap joins the first existing cluster it
  //    shares a keyword with, else opens a new one. Stable given input order.
  type Cluster = { keywords: Set<string>; items: GapItem[] };
  const clusters: Cluster[] = [];
  for (const item of gapItems) {
    const hit = clusters.find((c) => item.keywords.some((k) => c.keywords.has(k)));
    if (hit) {
      hit.items.push(item);
      for (const k of item.keywords) hit.keywords.add(k);
    } else {
      clusters.push({ keywords: new Set(item.keywords), items: [item] });
    }
  }

  // 3) Shape each cluster into a KbGap.
  const gaps: KbGap[] = clusters.map((c) => {
    // Theme = the keyword that appears across the most tickets in the cluster
    // (tie-break: alphabetical) — a stable, human-readable label.
    const counts = new Map<string, number>();
    for (const it of c.items) {
      for (const k of uniq(it.keywords)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const theme =
      Array.from(counts.entries()).sort(
        (a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      )[0]?.[0] ?? 'general';

    // Seed the article title from the shortest example title — the most concise
    // phrasing of the recurring question — with a stable alphabetical tie-break.
    const suggestedTitle = [...c.items]
      .sort((a, b) => (a.title.length - b.title.length) || (a.title < b.title ? -1 : 1))[0]
      .title;

    const exampleTickets: GapExample[] = c.items
      .map(({ ref, title, question, score }) => ({ ref, title, question, score }))
      .slice(0, maxExamples);

    // "How close is the KB today?" = the best any article managed across the theme.
    const bestKbScore = c.items.reduce((m, it) => Math.max(m, it.score), 0);

    return { theme, suggestedTitle, frequency: c.items.length, bestKbScore, exampleTickets };
  });

  // 4) Rank: most frequent first, then worst coverage, then theme for stability.
  gaps.sort(
    (a, b) =>
      (b.frequency - a.frequency) ||
      (a.bestKbScore - b.bestKbScore) ||
      (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : 0),
  );

  return gaps;
}
