// CI test-suite trigger API (admin only).
//
//   POST — dispatch the `test.yml` GitHub Actions workflow on lewis159/sentinel@main
//          (the unit/integration/e2e suite that runs in CI, not in this process).
//   GET  — return the most recent test.yml runs so the UI can show current/last status
//          with a link to the Actions run (polled while a run is in_progress).
//
// Admin-gated. Prod-safe: a workflow_dispatch only kicks CI — no destructive local
// action. Missing HERMES_GITHUB_TOKEN → a clean `not_configured` response (button
// disabled in the UI), never a throw. Workflow file not merged yet → `workflow_not_found`.
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { dispatchCiWorkflow, listCiRuns } from '@/lib/smoke/ci';

export const dynamic = 'force-dynamic';

// GET — recent runs (or a not_configured / workflow_not_found state with runs: []).
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;
  const result = await listCiRuns();
  return NextResponse.json(result);
}

// POST — dispatch the workflow. Always 200 with an { ok, ... } body describing the
// outcome (not_configured / workflow_not_found / github_error are expected states the
// UI surfaces, not HTTP errors).
export async function POST() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;
  const result = await dispatchCiWorkflow();
  return NextResponse.json(result);
}
