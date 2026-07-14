// Internal Knowledge Q&A — the ask endpoint.
//
//   POST /api/v2/admin/knowledge/ask
//   body: { question: string }
//   → 200 { status, answer, sources[], model? }
//
// A staff user asks one question; the Brain answers grounded strictly in the
// estate's institutional knowledge (KB + resolved tickets + roadmap) and returns
// the sources it used. READ-ONLY — no tools, no proposals, no writes.
//
// Gated by the `hermes` section (requireSectionApi) — internal staff only. Behind
// HERMES_BRAIN_ENABLED: returns a clear { status:'disabled' } message when off
// (never an error, never touches the model), so it is dormant-safe until the brain
// + a model key are configured. Rate-limited per user to bound LLM spend.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { brainEnabledRuntime } from '@/lib/hermes/runtime-flags';
import {
  answerKnowledgeQuestion,
  BRAIN_DISABLED_MESSAGE,
} from '@/lib/hermes/brain/knowledge';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Bound LLM spend: 20 questions / minute per user (per instance).
const RATE = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  // Flag OFF → clear disabled message, no model call, never an error. Resolved via
  // the runtime store (DB override → env default) so the Integrations-page toggle
  // takes effect with no redeploy.
  if (!(await brainEnabledRuntime())) {
    return NextResponse.json({
      status: 'disabled',
      answer: BRAIN_DISABLED_MESSAGE,
      sources: [],
    });
  }

  let question = '';
  try {
    const body: any = await req.json();
    question = typeof body?.question === 'string' ? body.question.trim() : '';
  } catch {
    /* fallthrough to validation */
  }
  if (!question) {
    return NextResponse.json(
      { status: 'error', answer: 'A question is required.', sources: [], error: 'question is required' },
      { status: 200 },
    );
  }
  if (question.length > 2000) question = question.slice(0, 2000);

  const { userId } = await getSessionAccess();
  const rl = checkRateLimit(`knowledge:${userId ?? 'anon'}`, RATE);
  if (!rl.ok) {
    return NextResponse.json(
      {
        status: 'error',
        answer: 'Too many questions — please wait a moment and try again.',
        sources: [],
        error: 'rate_limited',
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const result = await answerKnowledgeQuestion(question);
  return NextResponse.json(result);
}
