// v2 Agent Observability API — GET /api/v2/admin/observability
// Returns the full Hermes observability snapshot (proposals / executions /
// budget / audit aggregates) as JSON. Read-only; every underlying metric is
// mock-safe (getObservability never throws — no DB ⇒ zeroed structures with
// live:false), so this endpoint never 500s on a missing/empty spine.
//
// Auth: gated by the same 'hermes' section as the dashboard page. The page
// itself server-renders getObservability() directly; this route exists for
// programmatic / client-side consumers of the same metrics.

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getObservability } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  const data = await getObservability();
  return NextResponse.json(data);
}
