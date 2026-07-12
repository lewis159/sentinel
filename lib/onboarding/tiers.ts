// Onboarding — tier → key-feature map (PURE module, no server-only imports so it
// is safe to import from client, server, and unit tests alike).
//
// This is the reference the onboarding assistant uses to answer two questions:
//   1. "What are the headline features on this customer's plan?"  (tier → features)
//   2. "Which of those has this customer NOT used yet?"           (unused-feature gap)
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  PLACEHOLDER FEATURE LIST — NEEDS BEN'S REAL MAPPING.
// The tier ladder is taken from the Scribuo 7-rung model (memory:
// project_scribuo_tiers) and the feature set from the YT/Scribuo backlog. The
// exact feature→tier bundling is admin-editable config in the real product and
// is NOT authoritative here. Treat FEATURES / TIER_FEATURES below as a sensible
// default to be replaced with the canonical tier matrix before launch.
// ─────────────────────────────────────────────────────────────────────────────

export type TierKey =
  | 'free'
  | 'starter'
  | 'pro'
  | 'studio'
  | 'business'
  | 'reseller'
  | 'enterprise';

// Canonical tier order (cheapest → richest). Used to normalise unknown labels.
export const TIER_ORDER: TierKey[] = [
  'free',
  'starter',
  'pro',
  'studio',
  'business',
  'reseller',
  'enterprise',
];

export const TIER_LABEL: Record<TierKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  studio: 'Studio',
  business: 'Business',
  reseller: 'Reseller',
  enterprise: 'Enterprise',
};

export type FeatureKey =
  | 'transcribe'
  | 'ai_summary'
  | 'full_text_search'
  | 'premium_asr'
  | 'rss_automation'
  | 'playlist_import'
  | 'clips'
  | 'dub'
  | 'audiogram'
  | 'teams'
  | 'api_access'
  | 'sso'
  | 'white_label';

export type FeatureDef = {
  key: FeatureKey;
  label: string;
  // One-line "here's what it does / why try it" used in the nudge draft.
  description: string;
  // Higher = more valuable to surface first when choosing the "top unused
  // feature" to nudge about. Deterministic tie-break is FEATURES declaration order.
  priority: number;
  // Deep-link hint (relative path in the customer's product) — advisory only.
  tryHref?: string;
};

// The catalog. Order here is the deterministic tie-break for equal priority.
export const FEATURES: FeatureDef[] = [
  { key: 'transcribe', label: 'Transcribe a video', description: 'Turn any video or audio into an accurate, searchable transcript.', priority: 100, tryHref: '/new' },
  { key: 'ai_summary', label: 'AI summary', description: 'Get a one-click AI summary and key moments from every transcript.', priority: 90, tryHref: '/summary' },
  { key: 'full_text_search', label: 'Full-text search', description: 'Search across every transcript in your library instantly.', priority: 80, tryHref: '/search' },
  { key: 'premium_asr', label: 'Premium ASR', description: 'Switch on high-accuracy transcription with speaker labels.', priority: 70, tryHref: '/settings/asr' },
  { key: 'rss_automation', label: 'RSS auto-ingest', description: 'Auto-transcribe new episodes from an RSS feed — hands-free.', priority: 65, tryHref: '/automation' },
  { key: 'playlist_import', label: 'Playlist import', description: 'Bulk-import a whole playlist or channel in one go.', priority: 60, tryHref: '/import' },
  { key: 'clips', label: 'Auto clips', description: 'Generate short vertical clips with burned-in captions automatically.', priority: 55, tryHref: '/clips' },
  { key: 'dub', label: 'AI dubbing', description: 'Dub your content into another language with AI voices.', priority: 50, tryHref: '/dub' },
  { key: 'audiogram', label: 'Audiograms', description: 'Turn a quote into a shareable animated audiogram.', priority: 45, tryHref: '/audiogram' },
  { key: 'teams', label: 'Invite your team', description: 'Add teammates and share a workspace with shared libraries.', priority: 40, tryHref: '/team' },
  { key: 'api_access', label: 'API access', description: 'Automate everything with the Scribuo API and webhooks.', priority: 35, tryHref: '/settings/api' },
  { key: 'sso', label: 'Single sign-on', description: 'Set up SSO so your team signs in with your identity provider.', priority: 30, tryHref: '/settings/sso' },
  { key: 'white_label', label: 'White-label', description: 'Brand the workspace as your own for clients.', priority: 25, tryHref: '/settings/branding' },
];

const FEATURE_BY_KEY: Record<FeatureKey, FeatureDef> = FEATURES.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<FeatureKey, FeatureDef>,
);

export function featureDef(key: FeatureKey): FeatureDef {
  return FEATURE_BY_KEY[key];
}

// Which headline features each tier UNLOCKS. Cumulative in spirit (a higher tier
// gets everything below it) but written out explicitly so the mapping is obvious
// and easy for Ben to correct.
export const TIER_FEATURES: Record<TierKey, FeatureKey[]> = {
  free: ['transcribe'],
  starter: ['transcribe', 'ai_summary'],
  pro: ['transcribe', 'ai_summary', 'full_text_search', 'premium_asr', 'rss_automation', 'playlist_import'],
  studio: ['transcribe', 'ai_summary', 'full_text_search', 'premium_asr', 'rss_automation', 'playlist_import', 'clips', 'dub', 'audiogram', 'teams'],
  business: ['transcribe', 'ai_summary', 'full_text_search', 'premium_asr', 'rss_automation', 'playlist_import', 'clips', 'dub', 'audiogram', 'teams', 'api_access', 'sso'],
  reseller: ['transcribe', 'ai_summary', 'full_text_search', 'premium_asr', 'rss_automation', 'playlist_import', 'clips', 'dub', 'audiogram', 'teams', 'api_access', 'sso', 'white_label'],
  enterprise: ['transcribe', 'ai_summary', 'full_text_search', 'premium_asr', 'rss_automation', 'playlist_import', 'clips', 'dub', 'audiogram', 'teams', 'api_access', 'sso', 'white_label'],
};

// Normalise an arbitrary tier string (entitlement value, mock, free-text) to a
// known TierKey. Unknown / empty → 'free' (least-privilege default so we never
// over-promise features the customer may not have).
export function normalizeTier(raw: string | null | undefined): TierKey {
  const t = (raw ?? '').trim().toLowerCase();
  if ((TIER_ORDER as string[]).includes(t)) return t as TierKey;
  // A few common aliases.
  if (t === 'agency') return 'reseller';
  if (t === 'team' || t === 'teams') return 'studio';
  if (t === 'growth' || t === 'plus') return 'pro';
  return 'free';
}

// The feature keys unlocked by a (possibly raw) tier value.
export function featuresForTier(tier: string | null | undefined): FeatureKey[] {
  return TIER_FEATURES[normalizeTier(tier)] ?? [];
}
