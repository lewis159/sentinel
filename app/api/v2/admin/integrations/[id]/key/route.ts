// Integrations admin — set / rotate an integration's key (admin only).
//
//   POST /api/v2/admin/integrations/:id/key   body: { value: string }
//   → 200 { ok: boolean, error? }
//
// Masked WRITE of a new key value to Infisical hermes/prod. The value is stored
// server-side and is NEVER echoed back. The rotation is audited (who/which/when,
// never the value).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { writeIntegrationKey } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  const { id } = await params;

  let value: unknown;
  try {
    const body: any = await req.json();
    value = body?.value;
  } catch {
    value = undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return NextResponse.json(
      { ok: false, error: 'value must be a non-empty string' },
      { status: 400 },
    );
  }

  const { userId } = await getSessionAccess();

  try {
    const result = await writeIntegrationKey(id, value, userId ?? 'operator');
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to set key' },
      { status: 500 },
    );
  }
}
