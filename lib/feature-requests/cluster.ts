// Feature-request clustering — the DETERMINISTIC core.
//
// This module is PURE (no DB, no model, no server-only imports) so it is trivially
// unit-testable and runs identically whether or not the Hermes Brain is enabled.
// It takes a flat list of feature-request candidates (title + summary + how long
// ago they arrived) and groups them into ranked THEMES by shared keyword/stem
// overlap, then scores each theme by volume + recency.
//
// The service layer (./service.ts) pulls the candidates from real data and, when
// the Brain is on, refines the labels with the model — but the output of THIS file
// is always what the page falls back to, so the surface is useful while dormant.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// One incoming feature-request signal. `ageMs` is how long ago it arrived (0 =
// just now); we use it for recency weighting so the clusterer never needs an
// absolute clock and stays deterministic in tests.
export type Candidate = {
  ref: string;
  title: string;
  summary: string;
  ageMs: number;
  app?: string;
  source: 'request' | 'feedback';
};

export type ClusterExample = {
  ref: string;
  title: string;
  href: string;
  source: 'request' | 'feedback';
};

export type ClusterTrend = 'rising' | 'steady' | 'cooling';

export type FeatureCluster = {
  // Stable key derived from the theme's signature stems (for React keys / linking).
  key: string;
  // Human label — top keywords for the deterministic path; replaced by a cleaner
  // model label when the Brain refines.
  label: string;
  // The salient keywords behind the theme (surface forms), most-signal first.
  keywords: string[];
  count: number;
  examples: ClusterExample[];
  // Freshest item's age, in ms (0 = just now) + a relative string for display.
  mostRecentMs: number;
  mostRecent: string;
  trend: ClusterTrend;
  // How many of the theme's items arrived inside the recent window.
  recentCount: number;
  // Ranking score (volume + recency). Higher = higher priority.
  score: number;
  // Optional Brain-refined fields (only populated when HERMES_BRAIN_ENABLED and a
  // refinement succeeds). Never block the deterministic output.
  summary?: string;
  suggestedRoadmapTitle?: string;
  refined?: boolean;
};

export type ClusterOptions = {
  // Max example tickets carried per theme (default 4).
  maxExamples?: number;
  // Recency window in ms; items newer than this count toward `recentCount` and
  // the "rising" trend (default 14 days).
  recentWindowMs?: number;
  // Recency horizon in ms; freshness decays linearly to 0 across this span
  // (default 30 days).
  recencyHorizonMs?: number;
  // Extra weight given to recency in the score (default 3). Volume weight is 1.
  recencyWeight?: number;
  // Builds the href for an example ticket from its ref (default → /v2 detail).
  hrefFor?: (c: Candidate) => string;
};

const DAY = 24 * 60 * 60 * 1000;

const DEFAULTS: Required<Omit<ClusterOptions, 'hrefFor'>> = {
  maxExamples: 4,
  recentWindowMs: 14 * DAY,
  recencyHorizonMs: 30 * DAY,
  recencyWeight: 3,
};

// ---------------------------------------------------------------------------
// Tokenisation + light stemming
// ---------------------------------------------------------------------------

// Common English + product-noise words that carry no theme signal. Kept
// deliberately small and stable so grouping is predictable.
export const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'our', 'are',
  'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can', 'could', 'would',
  'should', 'will', 'from', 'into', 'out', 'off', 'per', 'via', 'when', 'while',
  'they', 'them', 'their', 'there', 'here', 'what', 'which', 'who', 'whom',
  'how', 'why', 'all', 'any', 'some', 'more', 'most', 'other', 'such', 'than',
  'then', 'once', 'only', 'also', 'just', 'like', 'get', 'got', 'let', 'able',
  'please', 'want', 'need', 'needs', 'add', 'adding', 'added', 'support',
  'feature', 'request', 'requests', 'requested', 'requesting', 'ability',
  'option', 'options', 'allow', 'allows', 'allowed', 'make', 'makes', 'made',
  'use', 'used', 'using', 'new', 'app', 'would', 'like', 'able', 'user',
  'users', 'customer', 'customers', 'team', 'give', 'gives', 'set', 'way',
]);

// Normalise a raw string into whitespace-delimited lowercase word tokens with
// punctuation stripped.
function rawTokens(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Very light Porter-lite stemmer: enough to fold plurals/tenses so "exports",
// "exporting" and "export" collapse to one stem. Deterministic and dependency-free.
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  for (const suf of ['ational', 'ization', 'iveness', 'ingly', 'edly', 'ing', 'ment', 'ness', 'ions', 'tion', 'ers', 'ing', 'ed', 'es', 'ly', 's']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, w.length - suf.length);
      break;
    }
  }
  return w;
}

// Tokenise + de-stopword + stem. Returns the list of theme-bearing stems (with
// repeats, so callers can count term frequency), plus a stem→surface map so we
// can render a readable keyword for each stem later.
export function tokenize(text: string): { stems: string[]; surface: Map<string, string> } {
  const stems: string[] = [];
  const surface = new Map<string, string>();
  for (const tok of rawTokens(text)) {
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue; // pure numbers carry no theme signal
    const s = stem(tok);
    if (s.length < 3) continue;
    stems.push(s);
    // Prefer the shortest surface form as the representative (usually the base word).
    const existing = surface.get(s);
    if (!existing || tok.length < existing.length) surface.set(s, tok);
  }
  return { stems, surface };
}

// ---------------------------------------------------------------------------
// Union-find (for connecting candidates that share salient stems)
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Deterministic: always attach the higher root to the lower one.
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

// ---------------------------------------------------------------------------
// The clusterer
// ---------------------------------------------------------------------------

type Prepared = {
  cand: Candidate;
  stemCounts: Map<string, number>;
  surface: Map<string, string>;
};

function defaultHref(c: Candidate): string {
  // Route to the ITIL detail surface the rest of v2 uses for a ticket ref.
  return `/v2/requests/${encodeURIComponent(c.ref)}`;
}

function relAge(ms: number): string {
  if (ms <= 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// linear freshness in [0,1]: 1 = just now, 0 = at/after the horizon.
function freshness(ageMs: number, horizon: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= horizon) return 0;
  return 1 - ageMs / horizon;
}

/**
 * Deterministically cluster feature-request candidates into ranked themes.
 *
 * Algorithm (pure, stable):
 *   1. Tokenise + stem each candidate's title+summary → per-item stem counts.
 *   2. Compute document-frequency per stem; a stem is "salient" if it appears in
 *      >= 2 candidates (i.e. it's shared → a genuine theme signal).
 *   3. Union-find: connect any two candidates that share >= 1 salient stem.
 *      Connected components become themes; a candidate that shares no salient
 *      stem with anyone forms its own single-item theme (nothing is lost).
 *   4. For each theme: label = its top salient stems (rendered as surface words),
 *      examples = up to maxExamples items, trend from the recent-window share,
 *      score = count + recencyWeight * avgFreshness.
 *   5. Sort themes by score desc, then by count, then freshest, then key.
 */
export function clusterFeatureRequests(
  candidates: Candidate[],
  options?: ClusterOptions,
): FeatureCluster[] {
  const opts = { ...DEFAULTS, ...options };
  const hrefFor = options?.hrefFor ?? defaultHref;

  // Stable input order → stable clustering. Sort by ref so tests are reproducible.
  const items = [...candidates].sort((a, b) => a.ref.localeCompare(b.ref));
  const n = items.length;
  if (n === 0) return [];

  // 1. Prepare per-item stems.
  const prepared: Prepared[] = items.map((cand) => {
    const { stems, surface } = tokenize(`${cand.title} ${cand.summary}`);
    const stemCounts = new Map<string, number>();
    for (const s of stems) stemCounts.set(s, (stemCounts.get(s) ?? 0) + 1);
    return { cand, stemCounts, surface };
  });

  // 2. Document frequency per stem.
  const df = new Map<string, number>();
  for (const p of prepared) {
    for (const s of p.stemCounts.keys()) df.set(s, (df.get(s) ?? 0) + 1);
  }
  const isSalient = (s: string) => (df.get(s) ?? 0) >= 2;

  // 3. Union-find over shared salient stems. Index items by salient stem so we
  //    only compare candidates that actually share one.
  const uf = new UnionFind(n);
  const byStem = new Map<string, number[]>();
  prepared.forEach((p, i) => {
    for (const s of p.stemCounts.keys()) {
      if (!isSalient(s)) continue;
      const list = byStem.get(s) ?? [];
      list.push(i);
      byStem.set(s, list);
    }
  });
  for (const idxs of byStem.values()) {
    for (let k = 1; k < idxs.length; k++) uf.union(idxs[0], idxs[k]);
  }

  // Gather components.
  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const list = components.get(root) ?? [];
    list.push(i);
    components.set(root, list);
  }

  // 4. Build a cluster per component.
  const clusters: FeatureCluster[] = [];
  for (const idxs of components.values()) {
    const members = idxs.map((i) => prepared[i]);

    // Aggregate stem frequency across the theme, weighted so a stem shared by
    // more members ranks above a stem that just repeats within one item.
    const themeStemScore = new Map<string, number>();
    const themeSurface = new Map<string, string>();
    const docCount = new Map<string, number>();
    for (const m of members) {
      for (const [s, c] of m.stemCounts) {
        themeStemScore.set(s, (themeStemScore.get(s) ?? 0) + c);
        docCount.set(s, (docCount.get(s) ?? 0) + 1);
        const surf = m.surface.get(s);
        const existing = themeSurface.get(s);
        if (surf && (!existing || surf.length < existing.length)) themeSurface.set(s, surf);
      }
    }

    // Rank keywords: prefer stems shared across members (higher docCount), then
    // total frequency, then alphabetical for determinism.
    const keywordStems = [...themeStemScore.keys()].sort((a, b) => {
      const da = docCount.get(a) ?? 0;
      const dbb = docCount.get(b) ?? 0;
      if (dbb !== da) return dbb - da;
      const fa = themeStemScore.get(a) ?? 0;
      const fb = themeStemScore.get(b) ?? 0;
      if (fb !== fa) return fb - fa;
      return a.localeCompare(b);
    });
    const keywords = keywordStems.slice(0, 4).map((s) => themeSurface.get(s) ?? s);
    const key = keywordStems.slice(0, 3).join('-') || members[0].cand.ref.toLowerCase();
    const label = keywords.length
      ? keywords.slice(0, 3).map(titleCase).join(' · ')
      : members[0].cand.title;

    // Examples — freshest first, capped.
    const sortedMembers = [...members].sort((a, b) => a.cand.ageMs - b.cand.ageMs);
    const examples: ClusterExample[] = sortedMembers.slice(0, opts.maxExamples).map((m) => ({
      ref: m.cand.ref,
      title: m.cand.title,
      href: hrefFor(m.cand),
      source: m.cand.source,
    }));

    const count = members.length;
    const mostRecentMs = Math.min(...members.map((m) => m.cand.ageMs));
    const recentCount = members.filter((m) => m.cand.ageMs <= opts.recentWindowMs).length;
    const avgFreshness =
      members.reduce((sum, m) => sum + freshness(m.cand.ageMs, opts.recencyHorizonMs), 0) / count;

    const recentRatio = recentCount / count;
    const trend: ClusterTrend =
      recentRatio >= 0.66 ? 'rising' : recentRatio <= 0.33 ? 'cooling' : 'steady';

    // Score = volume + recency weighting. Volume dominates; recency breaks ties
    // and lifts fresh themes of equal size.
    const score = count + opts.recencyWeight * avgFreshness;

    clusters.push({
      key,
      label,
      keywords,
      count,
      examples,
      mostRecentMs,
      mostRecent: relAge(mostRecentMs),
      trend,
      recentCount,
      score: Math.round(score * 1000) / 1000,
    });
  }

  // 5. Rank: score desc, then count desc, then freshest, then key for stability.
  clusters.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    if (a.mostRecentMs !== b.mostRecentMs) return a.mostRecentMs - b.mostRecentMs;
    return a.key.localeCompare(b.key);
  });

  return clusters;
}

function titleCase(w: string): string {
  return w.length ? w[0].toUpperCase() + w.slice(1) : w;
}

// Parse a relative age string ("just now" | "12m" | "3h" | "2d" | "—") back into
// an approximate age in ms. Used by the service layer to feed ageMs without
// needing an absolute created_at column on ServiceTicket. Unknown → a large age
// (treated as old) so it never falsely inflates recency.
export function ageStringToMs(age: string | null | undefined): number {
  if (!age || age === '—') return 90 * DAY;
  const a = age.trim().toLowerCase();
  if (a === 'just now') return 0;
  const m = a.match(/^(\d+)\s*([mhd])$/);
  if (!m) return 90 * DAY;
  const val = Number(m[1]);
  switch (m[2]) {
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * DAY;
    default: return 90 * DAY;
  }
}
