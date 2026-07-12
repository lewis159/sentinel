// Hermes · Market & Content — operator-maintained configuration.
//
// PURE module: no `server-only`, no DB, no network. Safe to import from server
// or client and trivially unit-testable. It holds two operator-maintained lists:
//
//   1. COMPETITORS     — the tracked competitor set with positioning / pricing
//                        NOTES an operator keeps up to date by hand.
//   2. TARGET_KEYWORDS — the SEO keyword targets the content pipeline drafts from.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ⚠️  OPERATOR-MAINTAINED + NO LIVE WEB DATA
//  These lists are a hand-curated snapshot. Nothing here is scraped or fetched.
//  Web research is NOT available server-side in this app, so competitor "scans"
//  and content drafts are LLM reasoning OVER THESE STORED NOTES — never live web
//  data. `lastReviewed` is the date an operator last hand-checked the entry.
//
//  TODO (real web/SEO source): to make scans reflect reality, wire a read-only
//  web-search / SEO-data provider (e.g. a search API for positioning/pricing
//  pages, and a keyword-metrics API for search volume / difficulty). Feed those
//  results into competitors.ts / content.ts alongside these notes, and surface a
//  "last live-scanned" timestamp distinct from `lastReviewed`. Until then every
//  brief is explicitly marked "analysis from stored notes, not live web data".
// ─────────────────────────────────────────────────────────────────────────────
//
// Seeded from the estate competitive context (memory: project_saas_teardown +
// the Scribuo product line) — the public transcription/content SaaS space Scribuo
// competes in. Edit these lists directly to add/retire a competitor or keyword.

export type Competitor = {
  slug: string; // stable id, used in the scan API + proposal ref
  name: string;
  url: string;
  positioning: string; // operator's one-line read on how they position
  pricingNotes: string; // operator's pricing snapshot (point-in-time)
  lastReviewed: string; // ISO date an operator last hand-checked this entry
};

export type ContentType = 'blog' | 'help' | 'landing';

export const CONTENT_TYPES: ContentType[] = ['blog', 'help', 'landing'];

// True — flags to the UI/API that this config is a hand-maintained snapshot and
// that live scanning still needs a real source wired (see TODO above).
export const OPERATOR_MAINTAINED = true;
export const LIVE_WEB_SOURCE_WIRED = false;

// The tracked competitor set (Scribuo's transcription / content-SaaS space).
// Positioning + pricing are OPERATOR NOTES, point-in-time — not live data.
export const COMPETITORS: Competitor[] = [
  {
    slug: 'otter-ai',
    name: 'Otter.ai',
    url: 'https://otter.ai',
    positioning:
      'AI meeting assistant — live transcription, speaker ID and auto-summaries, aimed at teams and meetings first, not creators.',
    pricingNotes:
      'Freemium: free tier with a monthly minutes cap; Pro and Business seats billed monthly/annually; enterprise on request.',
    lastReviewed: '2026-07-01',
  },
  {
    slug: 'rev',
    name: 'Rev',
    url: 'https://www.rev.com',
    positioning:
      'Accuracy-led transcription & captions — human + AI options, strong on legal/media compliance and turnaround guarantees.',
    pricingNotes:
      'Per-minute pricing (human ~premium vs automated ~cheap) plus a subscription for higher-volume automated use.',
    lastReviewed: '2026-07-01',
  },
  {
    slug: 'sonix',
    name: 'Sonix',
    url: 'https://sonix.ai',
    positioning:
      'Automated transcription + translation in many languages, with an in-browser editor; positioned to researchers and media teams.',
    pricingNotes:
      'Pay-as-you-go per audio hour plus premium/enterprise subscriptions that discount the hourly rate.',
    lastReviewed: '2026-07-01',
  },
  {
    slug: 'descript',
    name: 'Descript',
    url: 'https://www.descript.com',
    positioning:
      'Edit audio/video by editing the transcript — creator-first, bundles editing, overdub and clips around transcription.',
    pricingNotes:
      'Tiered seats (free + Hobbyist/Creator/Business) with monthly transcription-hour allowances per seat.',
    lastReviewed: '2026-07-01',
  },
  {
    slug: 'happyscribe',
    name: 'Happy Scribe',
    url: 'https://www.happyscribe.com',
    positioning:
      'Transcription + subtitles with a human-review option; leans into localisation/subtitling workflows for media.',
    pricingNotes:
      'Per-hour credits for automatic, higher per-minute for human; subscription tiers bundle monthly hours.',
    lastReviewed: '2026-07-01',
  },
  {
    slug: 'trint',
    name: 'Trint',
    url: 'https://trint.com',
    positioning:
      'Transcription + content workflows for newsrooms/enterprise — collaboration, story-building and export integrations.',
    pricingNotes:
      'Seat-based subscriptions (Starter/Advanced/Enterprise) with monthly file limits; enterprise custom.',
    lastReviewed: '2026-07-01',
  },
];

// SEO keyword targets the content pipeline drafts from. Operator-maintained.
// TODO (real SEO source): attach live search-volume / difficulty / intent from a
// keyword-metrics API so the operator can prioritise — currently hand-ordered.
export const TARGET_KEYWORDS: string[] = [
  'youtube video transcription',
  'convert video to text',
  'ai meeting notes',
  'podcast transcription software',
  'add subtitles to video',
  'transcribe audio to text',
  'srt caption generator',
  'interview transcription service',
];

// ── Read helpers (pure) ─────────────────────────────────────────────────────

/** All tracked competitors (returns a copy so callers can't mutate the seed). */
export function listCompetitors(): Competitor[] {
  return COMPETITORS.map((c) => ({ ...c }));
}

/** Look up one competitor by slug (case-insensitive). Null if unknown. */
export function getCompetitor(slug: string): Competitor | null {
  const s = (slug ?? '').trim().toLowerCase();
  return COMPETITORS.find((c) => c.slug.toLowerCase() === s) ?? null;
}

/** All SEO target keywords (copy). */
export function listKeywords(): string[] {
  return [...TARGET_KEYWORDS];
}

/** Type guard for the content-type union coming off the wire. */
export function isContentType(v: unknown): v is ContentType {
  return typeof v === 'string' && (CONTENT_TYPES as string[]).includes(v);
}
