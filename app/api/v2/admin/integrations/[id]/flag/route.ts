// Integrations admin — toggle the integration's runtime feature flag (admin only).
//
//   POST /api/v2/admin/integrations/:id/flag   body: { enabled: boolean }
//   → 200 { ok: boolean, error? }
//
// Writes the DB override (ops.hermes_runtime_flags) so the flag changes at
// runtime with NO redeploy. The flag resolver reads this override FIRST, else the
// env default. The toggle is audited (who/which flag/value).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { setIntegrationFlag } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  const { id } = await params;

  let enabled: unknown;
  try {
    const body: any = await req.json();
    enabled = body?.enabled;
  } catch {
    enabled = undefined;
  }

  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'enabled must be a boolean' },
      { status: 400 },
    );
  }

  const { userId } = await getSessionAccess();

  try {
    const result = await setIntegrationFlag(id, enabled, userId ?? 'operator');
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to set flag' },
      { status: 500 },
    );
  }
}
