// Hermes core runtime flags — read + toggle the CORE Hermes feature flags
// (HERMES_BRAIN_ENABLED, HERMES_INTAKE_ENABLED, HERMES_KB_PGVECTOR,
// HERMES_INNGEST_ENABLED, HERMES_TELEGRAM_ENABLED) from the admin UI (admin only).
//
//   GET  /api/v2/admin/hermes/flags            → { flags: RuntimeFlagState[] }
//   POST /api/v2/admin/hermes/flags   body: { flag, enabled: boolean }
//     → 200 { ok, error? }
//
// Unlike the Integrations page (which only toggles flags a third-party integration
// drives), these are the CORE Hermes flags that gate the Brain itself. Writes the
// DB override (ops.hermes_runtime_flags) so the flag changes at runtime with NO
// redeploy and NO stack-env edit — the resolver (getRuntimeFlag) reads the override
// FIRST, else the env default, with no cache, so a toggle is honored on the next
// request. Unknown flags are rejected. Every toggle is audited.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import {
  RUNTIME_FLAG_DEFAULTS,
  isKnownFlag,
  getRuntimeFlagState,
  setRuntimeFlag,
} from '@/lib/hermes/runtime-flags';
import { appendAudit } from '@/lib/hermes/audit';

export const dynamic = 'force-dynamic';

// GET — resolved state (effective value + source + env default) for every core flag.
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const flags = await Promise.all(
      Object.keys(RUNTIME_FLAG_DEFAULTS).map((flag) => getRuntimeFlagState(flag)),
    );
    return NextResponse.json({ flags });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to read Hermes runtime flags' },
      { status: 500 },
    );
  }
}

// POST — set a DB override for one core flag. Body: { flag, enabled }.
export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { flag?: unknown; enabled?: unknown }
    | null;

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof body.flag !== 'string' || !isKnownFlag(body.flag)) {
    // Reject anything not in RUNTIME_FLAG_DEFAULTS — this route only manages the
    // core Hermes flags, never arbitrary keys.
    return NextResponse.json(
      { ok: false, error: `Unknown flag: ${String(body.flag)}` },
      { status: 400 },
    );
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'enabled must be a boolean' }, { status: 400 });
  }

  const flag = body.flag;
  const enabled = body.enabled;

  const { userId } = await getSessionAccess();
  const actor = userId ?? 'operator';

  try {
    const result = await setRuntimeFlag(flag, enabled, actor);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    // Audit the toggle. `integration.flag.set` is an allow-listed audit action
    // (db/init/25) — reuse it: this is the same runtime-flag mechanism, applied
    // to a core Hermes flag rather than a third-party integration's flag.
    await appendAudit({
      actor,
      action: 'integration.flag.set',
      tool: 'hermes.core',
      summary: `${enabled ? 'Enabled' : 'Disabled'} ${flag} (Hermes core)`,
      detail: { flag, enabled, scope: 'hermes.core' },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to set flag' },
      { status: 500 },
    );
  }
}
