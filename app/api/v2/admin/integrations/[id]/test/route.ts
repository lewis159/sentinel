// Integrations admin — live connection test (admin only).
//
//   POST /api/v2/admin/integrations/:id/test
//   → 200 { ok: boolean, detail: string, status }
//
// Runs the integration's live probe against the CURRENTLY-STORED key. The key is
// read server-side and passed to the provider; it is NEVER returned to the
// client. The outcome (ok/detail) is audited.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { runIntegrationTest } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  const { id } = await params;
  const { userId } = await getSessionAccess();

  try {
    const result = await runIntegrationTest(id, userId ?? 'operator');
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, detail: e?.message ?? 'Test failed', status: 'fail' },
      { status: 500 },
    );
  }
}
