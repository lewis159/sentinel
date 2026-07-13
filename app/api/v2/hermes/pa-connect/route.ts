// PA Google connect — read connection STATUS and store/rotate the PA's Google
// access token (admin only).
//
//   GET  /api/v2/hermes/pa-connect  → { infisicalConfigured, connected, updatedAt }
//   POST /api/v2/hermes/pa-connect   body: { value: string }  → { ok, error? }
//
// The token is WRITE-ONLY: GET returns presence + updatedAt via getSecretMeta and
// NEVER the value; POST writes it to Infisical (PA_GOOGLE_ACCESS_TOKEN) and never
// echoes it back. The write is audited (who/when, never the value).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { getSecretMeta, setSecret, hasInfisical } from '@/lib/secrets';
import { appendAudit } from '@/lib/hermes/audit';
import { PA_GOOGLE_TOKEN_KEY } from '@/lib/pa/google';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  // Presence + updatedAt only — never the value. Env fallback counts as connected.
  const meta = await getSecretMeta(PA_GOOGLE_TOKEN_KEY);
  const connected = meta.exists || Boolean(process.env.PA_GOOGLE_ACCESS_TOKEN);
  return NextResponse.json({
    infisicalConfigured: hasInfisical(),
    connected,
    updatedAt: meta.updatedAt,
  });
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  let value: unknown;
  try {
    const body: any = await req.json();
    value = body?.value;
  } catch {
    value = undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return NextResponse.json({ ok: false, error: 'value must be a non-empty string' }, { status: 400 });
  }

  const res = await setSecret(PA_GOOGLE_TOKEN_KEY, value.trim());
  if (!res.ok) return NextResponse.json(res, { status: 400 });

  const { userId } = await getSessionAccess();
  await appendAudit({
    actor: userId ?? 'operator',
    action: 'integration.key.set',
    tool: 'pa-google',
    summary: `Set/rotated PA Google access token (${PA_GOOGLE_TOKEN_KEY})`,
    detail: { integration: 'pa-google', secretKey: PA_GOOGLE_TOKEN_KEY },
  });

  return NextResponse.json({ ok: true });
}
