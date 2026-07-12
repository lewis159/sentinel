// Hermes · Market & Content — SEO / content DRAFTING pipeline.
//
// From a target keyword + content type (blog / help / landing), produce a DRAFT:
//
//   • ALWAYS a deterministic skeleton (title, outline, meta description) built
//     from pure string logic — no model, no DB, no network. This is what the
//     dormant (brain-off) app shows, and it is the scaffold the model fills in.
//   • When HERMES_BRAIN_ENABLED, additionally a full body via callModel(),
//     grounded in the KB for `help` articles (retrieveKb) so help content stays
//     factually anchored to real runbook guidance.
//
// DRAFT-ONLY: "queueing" a draft calls saveProposal(kind:'content-draft'). That
// is a proposal in the approval queue — it is NEVER published anywhere. These
// proposals carry NO `action` and an EMPTY `ref`, so the approval path cannot
// post them to a ticket or execute a tool: approving simply marks the draft
// reviewed. Nothing in this module writes to any public surface.
//
// NO LIVE WEB / SEO DATA: keyword targets are the operator-maintained list in
// config.ts. See the real-source TODO there before trusting search-volume/intent.
import 'server-only';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { callModel } from '@/lib/hermes/brain/model';
import { retrieveKb } from '@/lib/hermes/kb-context';
import { saveProposal } from '@/lib/hermes/proposals';
import type { HermesProposal } from '@/lib/hermes/types';
import { isContentType, type ContentType } from './config';

const AGENT = 'market';

export type ContentSkeleton = {
  keyword: string;
  type: ContentType;
  title: string;
  outline: string[]; // section headings
  metaDescription: string;
};

export type ContentDraft = ContentSkeleton & {
  body: string | null; // full body when the brain drafted it, else null
  bodySource: 'model' | 'skeleton'; // where `body`/preview came from
  grounded: string[]; // KB slugs used to ground the draft (help articles)
  configured: boolean; // model available + brain on
  model?: string;
  note: string; // human-readable disclaimer for the UI
};

// ── Pure skeleton builders (no server-only deps at call time) ────────────────

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Deterministic section outline per content type. */
function outlineFor(type: ContentType, keyword: string): string[] {
  const kw = keyword.trim();
  switch (type) {
    case 'blog':
      return [
        'Introduction — the problem readers arrived with',
        `Why ${kw} matters`,
        `How to approach ${kw} (step by step)`,
        'Best practices and tips',
        'Common mistakes to avoid',
        'Conclusion and call to action',
      ];
    case 'help':
      return [
        'Overview — what this article covers',
        'Before you begin (prerequisites)',
        `Step-by-step: ${kw}`,
        'Troubleshooting common issues',
        'Related articles and next steps',
      ];
    case 'landing':
      return [
        `Hero headline — the promise of ${kw}`,
        'The problem your visitor has today',
        'How the product solves it',
        'Key benefits (3–4 bullets)',
        'Social proof / trust signals',
        'Pricing snapshot and primary CTA',
      ];
  }
}

/** Deterministic title per content type. */
function titleFor(type: ContentType, keyword: string): string {
  const kw = titleCase(keyword);
  switch (type) {
    case 'blog':
      return `${kw}: A Complete Guide`;
    case 'help':
      return `How to ${keyword.trim()}`;
    case 'landing':
      return `${kw} — Fast, Accurate, Effortless`;
  }
}

/** Deterministic meta description (~150 chars), keyword-led. */
function metaFor(type: ContentType, keyword: string): string {
  const kw = keyword.trim();
  const base: Record<ContentType, string> = {
    blog: `Learn ${kw} the easy way. This guide covers why it matters, how to do it step by step, best practices and mistakes to avoid.`,
    help: `Step-by-step help for ${kw}, including prerequisites, the exact steps to follow, and how to fix the most common issues.`,
    landing: `${titleCase(kw)} made simple — fast, accurate results with no setup. See how it works and get started in minutes.`,
  };
  const s = base[type];
  return s.length > 158 ? `${s.slice(0, 155).trimEnd()}…` : s;
}

/**
 * Build the deterministic skeleton for a keyword + type. PURE — never calls a
 * model, DB or network. This is the always-available scaffold (also what the
 * dormant app renders). Throws only on an invalid content type.
 */
export function buildContentSkeleton(keyword: string, type: ContentType): ContentSkeleton {
  const kw = (keyword ?? '').trim();
  if (!kw) throw new Error('keyword is required');
  if (!isContentType(type)) throw new Error(`invalid content type: ${String(type)}`);
  return {
    keyword: kw,
    type,
    title: titleFor(type, kw),
    outline: outlineFor(type, kw),
    metaDescription: metaFor(type, kw),
  };
}

// ── Draft orchestration (brain-aware) ────────────────────────────────────────

function skeletonAsMarkdown(sk: ContentSkeleton): string {
  const lines = [
    `# ${sk.title}`,
    '',
    `**Meta description:** ${sk.metaDescription}`,
    '',
    '## Outline',
    ...sk.outline.map((h) => `- ${h}`),
  ];
  return lines.join('\n');
}

/**
 * Draft content for a keyword + type.
 *
 *   • Always returns the deterministic skeleton fields.
 *   • With the brain ON and a model configured, also fills `body` via callModel.
 *     For `help` articles the prompt is grounded in the KB (retrieveKb) and the
 *     used slugs are returned in `grounded`.
 *   • With the brain OFF (or no model) `body` is null and `bodySource` is
 *     'skeleton' — NO model call is made.
 *
 * Never publishes. Pass `commit: true` to persist the draft as a
 * `content-draft` proposal in the approval queue and get its id back.
 */
export async function draftContent(input: {
  keyword: string;
  type: ContentType;
  commit?: boolean;
}): Promise<{ ok: boolean; error?: string; draft?: ContentDraft; proposalId?: string | null }> {
  let skeleton: ContentSkeleton;
  try {
    skeleton = buildContentSkeleton(input.keyword, input.type);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'invalid input' };
  }

  const grounded: string[] = [];
  let body: string | null = null;
  let bodySource: ContentDraft['bodySource'] = 'skeleton';
  let configured = false;
  let model: string | undefined;

  if (brainEnabled()) {
    // Ground help articles in the KB so they stay anchored to real runbook facts.
    let kbBlock = '';
    if (skeleton.type === 'help') {
      const hits = await retrieveKb(skeleton.keyword, 3);
      for (const h of hits) {
        grounded.push(h.slug);
        kbBlock += `\n### ${h.title}\n${h.body}\n`;
      }
    }

    const sys =
      'You are a senior SEO content writer for Scribuo, a transcription/content SaaS. ' +
      'Write clear, accurate, non-spammy DRAFT copy. Output GitHub-flavoured markdown only. ' +
      'This is a draft for human review — do not fabricate statistics, testimonials, or prices. ' +
      (skeleton.type === 'help'
        ? 'For help articles, stay strictly consistent with the KB context provided; if the KB does not cover a point, keep guidance generic rather than inventing specifics.'
        : '');

    const user =
      `Draft a ${skeleton.type} piece for the target keyword "${skeleton.keyword}".\n\n` +
      `Use this title: ${skeleton.title}\n` +
      `Follow this outline (one section each):\n${skeleton.outline.map((o) => `- ${o}`).join('\n')}\n\n` +
      `Target meta description: ${skeleton.metaDescription}\n` +
      (kbBlock ? `\nKB context to ground the article (do not contradict):\n${kbBlock}\n` : '') +
      '\nReturn the full markdown body only (no front-matter).';

    const res = await callModel({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      maxTokens: 1400,
    });

    if (res.ok && res.content.trim()) {
      body = res.content.trim();
      bodySource = 'model';
      configured = true;
      model = res.model;
    } else {
      // Model configured-but-failed (or empty) → fall back to the skeleton; the
      // note tells the operator why. Still never throws.
      configured = res.ok;
    }
  }

  const preview = body ?? skeletonAsMarkdown(skeleton);
  const note =
    bodySource === 'model'
      ? `Draft body generated by the model${model ? ` (${model})` : ''}${
          grounded.length ? `, grounded in KB: ${grounded.join(', ')}` : ''
        }. Review before use — nothing is published.`
      : brainEnabled()
        ? 'Deterministic skeleton only — the model was unavailable, so no body was generated. Review/expand before use.'
        : 'Deterministic skeleton only (Hermes Brain disabled). Turn on HERMES_BRAIN_ENABLED to draft a full body. Nothing is published.';

  const draft: ContentDraft = {
    ...skeleton,
    body,
    bodySource,
    grounded,
    configured,
    model,
    note,
  };

  let proposalId: string | null = null;
  if (input.commit) {
    const proposal: HermesProposal = {
      ok: true,
      configured,
      classification: `Market · content draft (${skeleton.type})`,
      draft: preview,
      sources: grounded.map((slug) => `kb:${slug}`),
      reasoning: note,
      model,
    };
    // ref is intentionally EMPTY so the approval path can never post this to a
    // ticket — a content draft has no ticket target and must not publish.
    proposalId = await saveProposal({
      ref: '',
      agent: AGENT,
      kind: 'content-draft',
      title: `${skeleton.title}`,
      summary: `${skeleton.type} draft for “${skeleton.keyword}”`,
      proposal,
    });
  }

  return { ok: true, draft, proposalId };
}
