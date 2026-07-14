// Internal Knowledge Q&A — a grounded, read-only estate answerer.
//
// answerKnowledgeQuestion(q) synthesises an answer to ONE staff question across the
// estate's institutional knowledge: the knowledge base (lib/hermes/kb-context →
// vector or lexical), resolved tickets (how past issues were actually settled), and
// the roadmap (what is planned / shipped). It:
//
//   1. RETRIEVES relevant context — KB via the existing retriever, plus a few
//      resolved tickets and roadmap items whose text overlaps the question.
//   2. Builds a GROUNDED prompt (the KNOWLEDGE persona SOUL + the retrieved context)
//      and calls the model through the SAME brain model path the copilots use
//      (brain/model.ts → getHermesRuntimeConfig).
//   3. Returns { answer, sources } where sources are ONLY the retrieved items the
//      model actually cited (fabricated citations are dropped by mapping the model's
//      cited refs back onto the retrieved set).
//
// Why a direct grounded call and NOT the ReAct graph (runPaTurn)? This is read-only,
// single-shot, tool-free Q&A — the exact shape of runCopilotProposal (persona SOUL +
// KB grounding + one callModel turn). The graph adds a checkpointer/thread + interrupt
// machinery that a no-tool answerer never needs, and would make the source contract
// harder to keep deterministic. So we mirror the copilot runner instead.
//
// FLAG-GATED behind HERMES_BRAIN_ENABLED: when off, returns a clear 'disabled'
// result WITHOUT retrieving or calling the model, so it is dormant-safe until the
// brain + a model key are configured.
import 'server-only';
import { callModel, type ChatMsg } from './model';
import { getPersona } from './personas';
import { brainEnabledRuntime } from '@/lib/hermes/runtime-flags';
import { retrieveKb } from '@/lib/hermes/kb-context';
import { getRecentTickets, getRoadmap } from '@/lib/data';

export type KnowledgeSourceType = 'kb' | 'ticket' | 'roadmap';

export type KnowledgeSource = {
  type: KnowledgeSourceType;
  ref: string; // KB slug, ticket ref, or roadmap item key
  title: string;
  href?: string; // where to read the full source in the console
};

export type KnowledgeResult =
  | { status: 'disabled'; answer: string; sources: KnowledgeSource[] }
  | { status: 'answered'; answer: string; sources: KnowledgeSource[]; model?: string }
  | { status: 'error'; answer: string; sources: KnowledgeSource[]; error: string };

export const BRAIN_DISABLED_MESSAGE =
  'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED and a model key to enable Knowledge Q&A.';

// "Done" ticket statuses across the ITIL kinds — a ticket in one of these states
// carries institutional knowledge about how something was actually settled.
const RESOLVED_STATUSES = new Set([
  'resolved',
  'closed',
  'fulfilled',
  'implemented',
  'verified',
  'deployed',
  'known_error',
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'up', 'as',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he',
  'she', 'my', 'our', 'your', 'their', 'me', 'us', 'them', 'not', 'no', 'so',
  'if', 'then', 'than', 'can', 'cannot', 'cant', 'will', 'wont', 'would', 'could',
  'should', 'do', 'does', 'did', 'have', 'has', 'had', 'get', 'got', 'about',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'please', 'help', 'hi',
  'hello', 'thanks', 'thank', 'im', 'ive', 'am', 'any', 'all', 'some', 'just',
  'now', 'out', 'off', 'there', 'here', 'into', 'over', 'more',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

// Rank arbitrary rows against the question by significant-word overlap on the
// fields the caller nominates. Dependency-free so the whole path stays testable.
function rankByOverlap<T>(
  rows: T[],
  query: Set<string>,
  fields: (row: T) => string,
  limit: number,
): T[] {
  if (query.size === 0) return [];
  const scored = rows.map((row) => {
    const words = significantWords(fields(row));
    let score = 0;
    for (const w of query) if (words.has(w)) score += 1;
    return { row, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((s) => s.row);
}

// Retrieve a small, relevant slice of estate knowledge for the question. Never
// throws — a failing ticket/roadmap read degrades to fewer sources, and KB
// retrieval already has its own lexical fail-safe.
async function retrieveContext(question: string): Promise<{
  kb: { slug: string; title: string; body: string }[];
  tickets: { ref: string; title: string; description: string; status: string }[];
  roadmap: { itemKey: string; title: string; description: string; status: string; app: string }[];
}> {
  const qWords = significantWords(question);

  const kb = await retrieveKb(question, 4).catch(() => []);

  // Resolved tickets from the last year, ranked against the question.
  let tickets: { ref: string; title: string; description: string; status: string }[] = [];
  try {
    const sinceIso = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const recent = await getRecentTickets(sinceIso, 200);
    const resolved = recent.rows.filter((t) => RESOLVED_STATUSES.has(String(t.status)));
    tickets = rankByOverlap(
      resolved,
      qWords,
      (t) => `${t.title} ${t.description ?? ''}`,
      3,
    ).map((t) => ({
      ref: t.ref,
      title: t.title,
      description: t.description ?? '',
      status: String(t.status),
    }));
  } catch {
    tickets = [];
  }

  // Roadmap items ranked against the question.
  let roadmap: {
    itemKey: string; title: string; description: string; status: string; app: string;
  }[] = [];
  try {
    const rm = await getRoadmap();
    roadmap = rankByOverlap(
      rm.rows,
      qWords,
      (r) => `${r.title} ${r.description ?? ''}`,
      3,
    ).map((r) => ({
      itemKey: r.itemKey,
      title: r.title,
      description: r.description ?? '',
      status: String(r.status),
      app: String(r.app ?? 'Estate'),
    }));
  } catch {
    roadmap = [];
  }

  return { kb, tickets, roadmap };
}

// Pull a strict-JSON object out of model output that may be fenced or wrapped in
// prose. Returns null if no balanced object parses.
function extractJson(raw: string): any | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Answer one internal staff question, grounded strictly in retrieved estate
 * knowledge. Draft/answer only — no tools, no proposals, no writes.
 *
 * Flag-gated: with HERMES_BRAIN_ENABLED off, returns { status:'disabled' } WITHOUT
 * retrieving or calling the model. Never throws.
 */
export async function answerKnowledgeQuestion(question: string): Promise<KnowledgeResult> {
  const q = (question ?? '').trim();
  if (!q) {
    return { status: 'error', answer: 'Ask a question to search the estate knowledge.', sources: [], error: 'empty question' };
  }

  // Dormant-safe: never retrieve or hit the model when the brain is off. Resolved
  // through the runtime store (DB override → env default) so an Integrations-page
  // toggle takes effect immediately, no redeploy.
  if (!(await brainEnabledRuntime())) {
    return { status: 'disabled', answer: BRAIN_DISABLED_MESSAGE, sources: [] };
  }

  const persona = getPersona('knowledge');
  if (!persona) {
    return { status: 'error', answer: 'Knowledge persona is not registered.', sources: [], error: 'no knowledge persona' };
  }

  const { kb, tickets, roadmap } = await retrieveContext(q);

  // The retrieved grounding set, keyed by the ref the model is told to cite.
  const available = new Map<string, KnowledgeSource>();
  for (const a of kb) {
    available.set(a.slug.toLowerCase(), {
      type: 'kb',
      ref: a.slug,
      title: a.title,
      href: `/v2/kb/${a.slug}`,
    });
  }
  for (const t of tickets) {
    available.set(t.ref.toLowerCase(), {
      type: 'ticket',
      ref: t.ref,
      title: t.title,
      href: `/v2/support`,
    });
  }
  for (const r of roadmap) {
    available.set(r.itemKey.toLowerCase(), {
      type: 'roadmap',
      ref: r.itemKey,
      title: r.title,
      href: `/v2/roadmap`,
    });
  }

  // Build the grounded context block. When nothing was retrieved we still ask the
  // model — the SOUL forces an honest "I don't know" rather than an invented answer.
  const contextParts: string[] = [];
  if (kb.length > 0) {
    contextParts.push(
      'KNOWLEDGE-BASE ARTICLES:',
      ...kb.map((a) => `- [kb:${a.slug}] ${a.title}\n  ${a.body}`),
    );
  }
  if (tickets.length > 0) {
    contextParts.push(
      '',
      'RESOLVED TICKETS (how past issues were settled):',
      ...tickets.map((t) => `- [ticket:${t.ref}] (${t.status}) ${t.title}\n  ${t.description}`),
    );
  }
  if (roadmap.length > 0) {
    contextParts.push(
      '',
      'ROADMAP ITEMS:',
      ...roadmap.map((r) => `- [roadmap:${r.itemKey}] (${r.status}, ${r.app}) ${r.title}\n  ${r.description}`),
    );
  }
  const contextBlock =
    contextParts.length > 0
      ? contextParts.join('\n')
      : '(no estate knowledge matched this question)';

  const messages: ChatMsg[] = [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'system',
      content: `ESTATE CONTEXT — answer ONLY from what is below. Cite the bracketed ref (e.g. ${'`recover-stalled-worker`'}, ${'`INC-0002`'}, ${'`RM-004`'}) of every item you rely on in "sources".\n\n${contextBlock}`,
    },
    { role: 'user', content: q },
  ];

  const result = await callModel({ messages, model: persona.model, temperature: 0.1 });
  if (!result.ok) {
    return { status: 'error', answer: `Could not reach the model: ${result.error}`, sources: [], error: result.error };
  }

  const parsed = extractJson(result.content ?? '');
  const answer =
    parsed && typeof parsed.answer === 'string' && parsed.answer.trim()
      ? parsed.answer.trim()
      : (result.content ?? '').trim() || "I couldn't find an answer to that in the estate knowledge.";

  // Map the model's cited refs back onto the retrieved set — this DROPS any
  // fabricated citation and de-dupes, so a source link always resolves to a real
  // retrieved item.
  const citedRaw: string[] = Array.isArray(parsed?.sources)
    ? parsed.sources.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  const sources: KnowledgeSource[] = [];
  const seen = new Set<string>();
  for (const raw of citedRaw) {
    // Accept "kb:slug" / "slug" / "INC-0001" — strip any "type:" prefix.
    const key = raw.trim().toLowerCase().replace(/^(kb|ticket|roadmap):/, '');
    const hit = available.get(key);
    if (hit && !seen.has(hit.ref)) {
      seen.add(hit.ref);
      sources.push(hit);
    }
  }

  return { status: 'answered', answer, sources, model: result.model };
}
