// Hermes Agent Builder API — admin-gated persona drafting.
//
//   GET  → list existing drafts + the read-only-safe tool catalog + sections.
//   POST → one of three actions (body.action):
//            'generate' { brief, section? }  → draft a persona from a brief
//                                              (NOT persisted; returned for editing)
//            'save'     { draft }             → persist an (edited) draft (status='draft')
//            'approve'  { id }                → flip a draft 'draft' → 'approved'
//
// SAFETY (this is the meta-feature — safety is paramount):
//   * Admin-gated on EVERY method (requireSectionApi('admin')).
//   * A drafted persona is ALWAYS advisory / read-only — the brief can never
//     auto-grant a gated or side-effecting tool (sanitizeTools / sanitizeDraft).
//   * 'save' always writes status='draft'. 'approve' only flips the lifecycle flag
//     and records who/when — it does NOT register the persona into the live
//     registry and can NEVER make it executable. Turning an APPROVED draft into a
//     live persona is a separate, deliberate, MANUAL code/registration step; this
//     route never mutates the running persona set (lib/hermes/brain/personas.ts).
//   * create + approve are recorded in the hash-chained audit log (appendAudit).
//
// Mock-safe: with no DB the store uses an in-memory fallback, so every path works.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import {
  saveDraft,
  listDrafts,
  getDraft,
  setStatus,
  type PersonaDraft,
} from '@/lib/agent-builder/store';
import {
  generateDraft,
  sanitizeDraft,
  readOnlySafeToolNames,
} from '@/lib/agent-builder/generate';
import { appendAudit } from '@/lib/hermes/audit';

export const dynamic = 'force-dynamic';

const SECTIONS = ['support', 'operations', 'security'] as const;

// Compute the "advisory" flag for the UI: a draft with no gated tool is advisory-
// only. Fresh drafts always are (empty autonomy + read-only tools), but we derive
// it so the UI never has to trust a stored flag.
function isAdvisory(d: PersonaDraft): boolean {
  return Object.values(d.autonomy ?? {}).every((a) => a !== 'gated');
}

export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  const drafts = await listDrafts();
  return NextResponse.json({
    drafts: drafts.map((d) => ({ ...d, advisory: isAdvisory(d) })),
    tools: readOnlySafeToolNames(),
    sections: SECTIONS,
  });
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const action = typeof body?.action === 'string' ? body.action : '';
  const { userId } = await getSessionAccess();
  const actor = userId ? `web:${userId}` : 'web:unknown';

  // --- generate: draft from a brief (ephemeral, not persisted) ----------------
  if (action === 'generate') {
    const brief = typeof body?.brief === 'string' ? body.brief.trim() : '';
    if (!brief) {
      return NextResponse.json({ ok: false, error: 'brief is required' }, { status: 400 });
    }
    const result = await generateDraft({ brief, section: body?.section });
    return NextResponse.json({
      ok: true,
      draft: { ...result.draft, advisory: isAdvisory(result.draft) },
      usedModel: result.usedModel,
      modelError: result.modelError,
    });
  }

  // --- save: persist an (edited) draft, always status='draft' -----------------
  if (action === 'save') {
    const clean = sanitizeDraft(body?.draft);
    if ('error' in clean) {
      return NextResponse.json({ ok: false, error: clean.error }, { status: 400 });
    }
    const saved = await saveDraft(clean.draft, actor);
    await appendAudit({
      actor,
      action: 'persona.drafted',
      summary: `Persona draft "${saved.id}" created/updated by ${actor}`,
      detail: {
        id: saved.id,
        label: saved.label,
        section: saved.section,
        allowedTools: saved.allowedTools,
        advisory: isAdvisory(saved),
      },
    });
    return NextResponse.json({ ok: true, draft: { ...saved, advisory: isAdvisory(saved) } });
  }

  // --- approve: flip 'draft' → 'approved'. NOT activation. --------------------
  if (action === 'approve') {
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }
    const existing = await getDraft(id);
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'draft not found' }, { status: 404 });
    }
    const updated = await setStatus(id, 'approved', actor);
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'failed to approve draft' }, { status: 500 });
    }
    // Approval is a human gate on a DRAFT — it is NOT activation. We record it in
    // the immutable audit log and deliberately do NOT register the persona live.
    await appendAudit({
      actor,
      action: 'persona.approved',
      summary: `Persona draft "${id}" approved by ${actor} (NOT activated — activation is a manual step)`,
      detail: { id, label: updated.label, section: updated.section, live: false },
    });
    return NextResponse.json({ ok: true, draft: { ...updated, advisory: isAdvisory(updated) } });
  }

  return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
}
