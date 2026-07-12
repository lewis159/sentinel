// Feature-request clustering — the DATA + optional LLM-refinement layer.
//
// Pulls the feature-request signals from real data (lib/data), runs the
// deterministic clusterer (./cluster.ts — always), and, ONLY when the Hermes
// Brain is enabled, asks the model to produce cleaner theme labels + a one-line
// summary + a suggested roadmap-item title (a DRAFT — never written anywhere).
//
// Dormant-safe: with the Brain OFF, the model module is NEVER imported and the
// page renders the deterministic themes. Mock-safe: getTicketsByKind falls back
// to sample tickets with no DB, so the surface is useful in dev too.
//
// This module is intentionally NOT marked 'server-only' at the top so the unit
// tests can import it with `@/lib/data` and the model mocked; the heavy modules
// are lazy-imported inside functions, so nothing server-only loads unless used.

import { brainEnabled } from '@/lib/hermes/brain/flags';
import {
  clusterFeatureRequests,
  ageStringToMs,
  type Candidate,
  type FeatureCluster,
  type ClusterOptions,
} from './cluster';
import type { ServiceTicket } from '@/lib/mock';

export type FeatureClusterResult = {
  clusters: FeatureCluster[];
  // Did ANY underlying source come from the real database?
  live: boolean;
  // Was the Brain enabled AND did a refinement actually run?
  brainRefined: boolean;
  // Total candidate signals considered.
  candidateCount: number;
  // 'deterministic' | 'refined' — what produced the labels the page shows.
  labelSource: 'deterministic' | 'refined';
};

// A ticket counts as a product-feedback signal (as opposed to an ops request)
// when its source or attrs mark it so. The intake widget maps type=feedback →
// an incident, so we scan incidents for these markers as well as taking every
// `request`-kind ticket wholesale.
function isFeedbackSignal(t: ServiceTicket): boolean {
  const source = (t.source ?? '').toLowerCase();
  if (source === 'feedback') return true;
  const attrs = t.attrs ?? {};
  if (attrs.feedback === true) return true;
  const cat = String(attrs.category ?? attrs.type ?? '').toLowerCase();
  return cat === 'feature' || cat === 'feedback' || cat === 'feature_request';
}

function toCandidate(t: ServiceTicket, source: 'request' | 'feedback'): Candidate {
  return {
    ref: t.ref,
    title: t.title,
    summary: t.description ?? '',
    ageMs: ageStringToMs(t.age),
    app: typeof t.app === 'string' ? t.app : undefined,
    source,
  };
}

/**
 * Gather the feature-request candidate signals from real data.
 *   - Every `request`-kind ticket (the primary feature-request channel).
 *   - Any `incident`-kind ticket flagged as product feedback (source/attrs).
 * De-duped by ref (request wins). Mock-safe via getTicketsByKind's fallback.
 */
export async function gatherCandidates(): Promise<{ candidates: Candidate[]; live: boolean }> {
  const { getTicketsByKind } = await import('@/lib/data');

  const [requests, incidents] = await Promise.all([
    safeKind(getTicketsByKind, 'request'),
    safeKind(getTicketsByKind, 'incident'),
  ]);

  const byRef = new Map<string, Candidate>();
  for (const t of requests.rows) byRef.set(t.ref, toCandidate(t, 'request'));
  for (const t of incidents.rows) {
    if (!isFeedbackSignal(t)) continue;
    if (!byRef.has(t.ref)) byRef.set(t.ref, toCandidate(t, 'feedback'));
  }

  return {
    candidates: [...byRef.values()],
    live: requests.live || incidents.live,
  };
}

type KindReader = (
  kind: 'incident' | 'request' | 'change' | 'problem' | 'release',
) => Promise<{ rows: ServiceTicket[]; live: boolean }>;

async function safeKind(
  read: KindReader,
  kind: 'request' | 'incident',
): Promise<{ rows: ServiceTicket[]; live: boolean }> {
  try {
    return await read(kind);
  } catch {
    return { rows: [], live: false };
  }
}

/**
 * Produce the ranked feature-request themes for the console.
 *
 * Deterministic clustering ALWAYS runs. When the Brain is enabled, the clusters
 * are passed to the model for label/summary/roadmap-title refinement — as a
 * DRAFT only. If the Brain is off (or refinement fails) the deterministic labels
 * are returned unchanged. Never writes to the roadmap.
 */
export async function getFeatureRequestClusters(
  options?: ClusterOptions,
): Promise<FeatureClusterResult> {
  const { candidates, live } = await gatherCandidates();
  const deterministic = clusterFeatureRequests(candidates, options);

  // Dormant path: Brain off → NEVER import the model. Deterministic labels stand.
  if (!brainEnabled() || deterministic.length === 0) {
    return {
      clusters: deterministic,
      live,
      brainRefined: false,
      candidateCount: candidates.length,
      labelSource: 'deterministic',
    };
  }

  // Brain on: refine labels/summaries/roadmap titles as a draft. Best-effort —
  // any failure falls back to the deterministic clusters untouched.
  try {
    const refined = await refineWithBrain(deterministic);
    const didRefine = refined.some((c) => c.refined);
    return {
      clusters: refined,
      live,
      brainRefined: didRefine,
      candidateCount: candidates.length,
      labelSource: didRefine ? 'refined' : 'deterministic',
    };
  } catch {
    return {
      clusters: deterministic,
      live,
      brainRefined: false,
      candidateCount: candidates.length,
      labelSource: 'deterministic',
    };
  }
}

// ---------------------------------------------------------------------------
// LLM refinement (draft-only; gated by the caller on brainEnabled())
// ---------------------------------------------------------------------------

// Pull a balanced JSON value out of possibly-fenced/prosey model output.
function extractJson(raw: string): any | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    // Fall back to an object shape { themes: [...] }.
    const os = raw.indexOf('{');
    const oe = raw.lastIndexOf('}');
    if (os === -1 || oe === -1 || oe < os) return null;
    try {
      return JSON.parse(raw.slice(os, oe + 1));
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Ask the Brain model to rename/summarise the deterministic themes and suggest a
 * roadmap title for each. Returns a NEW cluster array — deterministic fields are
 * preserved; only label/summary/suggestedRoadmapTitle are enriched. On any error
 * the input clusters are returned unchanged (refined=false).
 */
export async function refineWithBrain(
  clusters: FeatureCluster[],
): Promise<FeatureCluster[]> {
  const { callModel } = await import('@/lib/hermes/brain/model');

  const themeLines = clusters.map((c, i) => {
    const examples = c.examples.map((e) => `“${e.title}”`).join('; ');
    return `#${i} — keywords: ${c.keywords.join(', ')} · ${c.count} request(s) · examples: ${examples}`;
  });

  const system =
    'You are the CTO copilot for the Sentinel ops console. You are given clusters ' +
    'of incoming feature requests, grouped by keyword. For EACH cluster, produce a ' +
    'crisp theme label (2-5 words), a one-line summary of what users are asking for, ' +
    'and a suggested roadmap-item title (imperative, product-ready). This is an ' +
    'advisory DRAFT for a human to review — you never create roadmap items yourself. ' +
    'Respond with ONLY a JSON array; one object per cluster in the SAME order, shape: ' +
    '[{"index":0,"label":"...","summary":"...","suggestedRoadmapTitle":"..."}]. ' +
    'Do not invent clusters that were not given.';

  const user = ['Clusters:', '', ...themeLines].join('\n');

  const result = await callModel({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 900,
  });

  if (!result.ok) return clusters;

  const parsed = extractJson(result.content ?? '');
  const arr: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.themes)
      ? parsed.themes
      : [];
  if (arr.length === 0) return clusters;

  // Index refinements by their reported index, clamped to range.
  const byIndex = new Map<number, any>();
  arr.forEach((r, i) => {
    const idx = Number.isInteger(r?.index) ? Number(r.index) : i;
    if (idx >= 0 && idx < clusters.length) byIndex.set(idx, r);
  });

  return clusters.map((c, i) => {
    const r = byIndex.get(i);
    if (!r) return c;
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : c.label;
    const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : undefined;
    const suggestedRoadmapTitle =
      typeof r.suggestedRoadmapTitle === 'string' && r.suggestedRoadmapTitle.trim()
        ? r.suggestedRoadmapTitle.trim()
        : undefined;
    return {
      ...c,
      label,
      summary,
      suggestedRoadmapTitle,
      refined: true,
    };
  });
}
