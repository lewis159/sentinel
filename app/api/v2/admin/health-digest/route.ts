// GET /api/v2/admin/health-digest — the Customer-Health Digest.
//
// Returns the portfolio roll-up (band counts, at-risk list, upsell candidates,
// top movers) plus the per-customer health scores. READ-ONLY. Gated by the
// 'hermes' section (the digest lives under the Hermes console). Mock-safe: with
// no DB it returns the curated mock portfolio, so the endpoint always responds.
//
// The optional LLM narrative is only computed when HERMES_BRAIN_ENABLED is on;
// otherwise `narrative` is null with narrativeSource === 'disabled'.
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { assembleHealthDigest } from '@/lib/health/digest';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  const digest = await assembleHealthDigest();
  return NextResponse.json(digest);
}
