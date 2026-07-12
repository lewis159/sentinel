import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { getSettings, setSettings } from '@/lib/settings/store';
import { SETTING_SECTIONS, settingsForSection } from '@/lib/settings/schema';
import { appendAudit } from '@/lib/hermes/audit';

export const dynamic = 'force-dynamic';

// GET /api/v2/settings/console — current stored console settings (admin only).
//
// Returns { settings } where `settings` is a map of key → stored value. Unset
// keys are ABSENT from the map (the UI renders them blank). Never fabricates a
// value: with no DB, `settings` is an empty object.
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to read console settings' },
      { status: 500 },
    );
  }
}

// POST /api/v2/settings/console — upsert one section's settings (admin only).
//
// Body: { section: string; values: Record<string, unknown> }
//   * `section` must be a known settings section.
//   * every key in `values` must belong to that section (rejected otherwise).
//   * a blank value clears the key (reads back blank).
//
// Persists, writes ONE audit event (console.settings.updated) recording the
// section + the keys changed — NOT the values — then re-reads and returns the
// current stored settings. Never echoes anything fabricated.
export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | { section?: unknown; values?: unknown }
      | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const section = body.section;
    if (typeof section !== 'string' || !(SETTING_SECTIONS as readonly string[]).includes(section)) {
      return NextResponse.json(
        { ok: false, error: 'Unknown or missing settings section' },
        { status: 400 },
      );
    }

    const values = body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return NextResponse.json(
        { ok: false, error: 'values must be an object' },
        { status: 400 },
      );
    }

    // Reject any key that does not belong to the named section (defence in depth
    // on top of the store's schema validation).
    const allowed = new Set(settingsForSection(section).map((d) => d.key));
    const entries = values as Record<string, unknown>;
    for (const k of Object.keys(entries)) {
      if (!allowed.has(k)) {
        return NextResponse.json(
          { ok: false, error: `Key '${k}' does not belong to section '${section}'` },
          { status: 400 },
        );
      }
    }

    const { role } = await getSessionAccess().catch(() => ({ role: undefined }));
    const actor = typeof role === 'string' ? role : 'admin';

    const result = await setSettings(entries, actor);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    // Audit the change — record the section + which keys changed, never values.
    if (result.written.length > 0) {
      await appendAudit({
        actor,
        action: 'console.settings.updated',
        summary: `Console settings updated · ${section}`,
        detail: { section, keys: result.written },
      });
    }

    // Re-read so the response reflects exactly what is stored (blanks for unset).
    const settings = await getSettings();
    return NextResponse.json({ ok: true, written: result.written, settings });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to save console settings' },
      { status: 500 },
    );
  }
}
