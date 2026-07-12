// Integrations admin — status list (admin only).
//
//   GET — the registry with per-integration status: is each mapped secret
//         present in Infisical (+ updatedAt), the feature-flag state, and whether
//         a live test exists. NEVER returns any secret value.
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { buildIntegrationsPayload } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    return NextResponse.json(await buildIntegrationsPayload());
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to load integrations' },
      { status: 500 },
    );
  }
}
