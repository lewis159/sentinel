// Live smoke-test runner API (admin only).
//
//   POST — run the full live smoke suite against the RUNNING app (process + DB +
//          config) and return the per-check results + a summary.
//   GET  — return the check catalog (names) so the UI can render the list before a
//          run.
//
// Admin-gated (requireSectionApi('admin')) — the same section the Hermes governance
// / autonomy settings use. Safe to run against prod: the suite is read-mostly and any
// write it makes is a self-cleaning, `__smoke__`-tagged artifact (see lib/smoke/checks.ts).
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { runSmokeChecks, smokeCatalog } from '@/lib/smoke/checks';

export const dynamic = 'force-dynamic';

// GET — catalog of check names (no execution).
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;
  return NextResponse.json({ checks: smokeCatalog() });
}

// POST — run the suite. The runner never throws (each check is wrapped), so a 500
// here would only ever be an auth/serialisation issue.
export async function POST() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const run = await runSmokeChecks();
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'smoke run failed' },
      { status: 500 },
    );
  }
}
