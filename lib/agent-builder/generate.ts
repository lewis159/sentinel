// Brief → PersonaDraft generation for the Hermes Agent Builder.
//
// Turns a plain-English brief into a DRAFT persona definition (id, label, SOUL
// system prompt, a suggested READ-ONLY tool set, section, autonomy defaults).
//
// Two layers:
//   1. A DETERMINISTIC SKELETON — always produced, no model needed. Derives a
//      stable id/label from the brief, a templated advisory SOUL, and an EMPTY
//      (read-only) tool set. This is what you get with the Brain off.
//   2. MODEL ENRICHMENT — only when brainEnabled() AND an OpenRouter key is
//      configured. The model fleshes out the SOUL and MAY suggest tools, but its
//      suggestions are hard-filtered to EXISTING, READ-ONLY registry tool names
//      (sanitizeTools). Any invented or side-effecting/gated tool is dropped.
//
// SAFETY: a brief-drafted persona is ALWAYS advisory / read-only. We NEVER
// auto-grant a gated or side-effecting tool from a brief — a human must add those
// deliberately later. The autonomy map is therefore always empty on a fresh draft
// (every tool it can hold is already `autonomy:'auto'`), and every persona is born
// as a DRAFT (see lib/agent-builder/store.ts).
import 'server-only';
import { ALL_TOOLS } from '@/lib/hermes/brain/tools';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { chat } from '@/lib/hermes/openrouter';
import type { RbacSection } from '@/lib/hermes/agent-meta';
import type { PersonaDraft } from './store';

// Tools that are `autonomy:'auto'` yet STILL cause a side effect (e.g. post to a
// channel). A brief-drafted persona must not auto-receive these — only pure reads.
// Kept as an explicit denylist because the registry has no `sideEffect` flag, so
// autonomy alone cannot distinguish broadcastStatus (auto + posts) from a read.
const AUTO_BUT_SIDE_EFFECTING = new Set<string>(['broadcastStatus']);

/**
 * The set of registry tool names a brief-drafted persona is allowed to reference:
 * every `autonomy:'auto'` tool that is not in the side-effecting denylist. Derived
 * from the live registry so it stays correct as the tool set grows, minus the one
 * auto-but-side-effecting tool.
 */
export function readOnlySafeToolNames(): string[] {
  return ALL_TOOLS.filter(
    (t) => t.autonomy === 'auto' && !AUTO_BUT_SIDE_EFFECTING.has(t.name),
  ).map((t) => t.name);
}

/**
 * Validate + sanitise a candidate tool list down to ONLY read-only-safe registry
 * tools. Drops anything invented (not in the registry), anything gated, and any
 * auto-but-side-effecting tool. De-duplicates, preserves order. This is the guard
 * that makes a model suggestion safe to persist.
 */
export function sanitizeTools(candidates: unknown): string[] {
  const safe = new Set(readOnlySafeToolNames());
  const out: string[] = [];
  if (!Array.isArray(candidates)) return out;
  for (const c of candidates) {
    if (typeof c === 'string' && safe.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

const VALID_SECTIONS: RbacSection[] = ['support', 'operations', 'security'];

export function normalizeSection(section: unknown): RbacSection {
  return VALID_SECTIONS.includes(section as RbacSection)
    ? (section as RbacSection)
    : 'operations';
}

// Derive a stable, slug-y id from the brief. Deterministic: same brief → same id.
function deriveId(brief: string): string {
  const slug = brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .slice(0, 40);
  return `draft-${slug || 'agent'}`;
}

// A human label from the brief — first few meaningful words, title-cased.
function deriveLabel(brief: string): string {
  const words = brief
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length === 0) return 'New Persona';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// The deterministic, advisory-only SOUL template. Read-only by construction.
function templateSoul(label: string, brief: string): string {
  return `# SOUL — ${label} (DRAFT)

You are **${label}**, a NEW advisory persona drafted for the Sentinel Hermes bench.
This is a DRAFT: you are not yet a live persona and you cannot execute anything.

## Mandate
${brief.trim()}

## How you operate (draft defaults)
- **Advisory-only.** You produce analysis, drafts, and recommendations for a human
  to review. You hold NO side-effecting tools — you cannot mutate tickets, deploy,
  move money, or post anywhere. Reading estate state (tickets, deploys) is the most
  you can do, and only if a human grants those read tools.
- **Grounded.** Base everything on state you can actually read; never invent facts,
  tickets, metrics, or policy to look diligent.
- **Bounded.** Say what you don't know, and hand anything that needs an action to
  the human (or owning exec) who holds that lever.

## Boundaries
- You never claim work is done — you recommend, a human decides.
- A human must explicitly review and approve this persona, and granting it any
  executable tool is a separate, deliberate step. Until then you are advisory-only.`;
}

export type GenerateInput = {
  brief: string;
  section?: unknown;
};

export type GenerateResult = {
  draft: PersonaDraft;
  usedModel: boolean;
  modelError?: string;
};

// The strict-JSON shape we ask the model for.
function safeJsonParse(s: string): { soul?: unknown; tools?: unknown } | null {
  // Tolerate a stray code fence or prose around the JSON object.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as any) : null;
  } catch {
    return null;
  }
}

async function enrichWithModel(
  brief: string,
): Promise<{ soul?: string; tools?: string[] } | { error: string }> {
  const safeList = readOnlySafeToolNames();
  const sys = `You help draft a NEW advisory persona for an operations console. The persona is ADVISORY-ONLY and READ-ONLY: it can never deploy, mutate tickets, move money, send email, or post anywhere.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose. Exactly this shape:
{
  "soul": string,        // a markdown system prompt (a "SOUL") for the persona, grounded in the brief
  "tools": string[]      // read-only tools the persona may need
}

Rules for "tools":
- You may ONLY use names from this EXACT list of read-only tools: [${safeList.join(', ')}].
- NEVER invent a tool name. NEVER include a tool that writes, deploys, refunds, emails, or posts.
- If unsure, return an empty array. Fewer tools is safer.`;

  const res = await chat({
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Brief: ${brief}` },
    ],
    temperature: 0.2,
  });
  if (!res.ok || !res.content) return { error: res.error ?? 'model returned no content' };

  const parsed = safeJsonParse(res.content);
  if (!parsed) return { error: 'model did not return parseable JSON' };

  const soul = typeof parsed.soul === 'string' && parsed.soul.trim() ? parsed.soul.trim() : undefined;
  // Hard-filter the model's suggestions to the read-only-safe registry set. This is
  // the guard: an invented or side-effecting tool never survives.
  const tools = sanitizeTools(parsed.tools);
  return { soul, tools };
}

/**
 * Generate a DRAFT persona definition from a plain-English brief.
 *
 * Always returns a coherent draft: the deterministic skeleton is the floor, and
 * model enrichment (when brainEnabled + configured) only improves the SOUL and may
 * add read-only tools. The draft is ALWAYS advisory/read-only and is NOT persisted
 * or registered here — the caller saves it (as a draft) via the store.
 */
export async function generateDraft(input: GenerateInput): Promise<GenerateResult> {
  const brief = (input.brief ?? '').trim();
  const section = normalizeSection(input.section);
  const id = deriveId(brief);
  const label = deriveLabel(brief);

  // --- Layer 1: deterministic skeleton (advisory, read-only, no tools) --------
  const skeleton: PersonaDraft = {
    id,
    label,
    systemPrompt: templateSoul(label, brief || '(no brief provided)'),
    allowedTools: [],
    section,
    autonomy: {}, // no gated tools on a fresh draft → nothing to override
  };

  // Brain off → skeleton only, no model call.
  if (!brainEnabled()) {
    return { draft: skeleton, usedModel: false };
  }

  // --- Layer 2: model enrichment (SOUL + read-only tool suggestions) ----------
  const enriched = await enrichWithModel(brief);
  if ('error' in enriched) {
    // Enrichment failed → fall back to the deterministic skeleton, unchanged.
    return { draft: skeleton, usedModel: false, modelError: enriched.error };
  }

  return {
    draft: {
      ...skeleton,
      systemPrompt: enriched.soul ?? skeleton.systemPrompt,
      allowedTools: enriched.tools ?? [],
      // autonomy stays empty: every allowed tool is a read (`autonomy:'auto'`), so
      // there is nothing to gate — and we never auto-grant a gated tool anyway.
      autonomy: {},
    },
    usedModel: true,
  };
}

/**
 * Validate + sanitise an admin-EDITED draft before it is persisted. Coerces the
 * fields, forces the tool set back through the read-only-safe filter (so a hand-
 * edited allowedTools can't smuggle in a gated/invented tool), normalises the
 * section, and clears autonomy (a draft never carries gated overrides). Returns a
 * clean PersonaDraft or an error string.
 */
export function sanitizeDraft(input: unknown): { draft: PersonaDraft } | { error: string } {
  const d = (input ?? {}) as Record<string, unknown>;
  const id = typeof d.id === 'string' ? d.id.trim() : '';
  const label = typeof d.label === 'string' ? d.label.trim() : '';
  const systemPrompt = typeof d.systemPrompt === 'string' ? d.systemPrompt.trim() : '';
  if (!id) return { error: 'id is required' };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { error: 'id must be lowercase letters, numbers and hyphens' };
  }
  if (!label) return { error: 'label is required' };
  if (!systemPrompt) return { error: 'system prompt (SOUL) is required' };

  return {
    draft: {
      id,
      label,
      systemPrompt,
      allowedTools: sanitizeTools(d.allowedTools),
      section: normalizeSection(d.section),
      autonomy: {}, // drafts never carry gated overrides
    },
  };
}
