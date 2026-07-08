import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { requireSectionApi } from '@/lib/auth';
import { ALL_SECTIONS, ROLE_PRESETS } from '@/lib/v2/rbac';

export const dynamic = 'force-dynamic';

// POST /api/v2/access — set a staff member's role and/or section override in
// Clerk publicMetadata. Only callers with the 'admin' section may mutate access.
//
// Body: { userId: string, role?: string, sections?: string[] | null }
//   - role provided  → must be a known ROLE_PRESETS key
//   - sections array  → must be ⊆ ALL_SECTIONS; stored as the override
//   - sections null   → removes the override (falls back to the role preset)

const SECTION_SET = new Set<string>(ALL_SECTIONS);

export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | { userId?: unknown; role?: unknown; sections?: unknown }
      | null;

    if (!body || typeof body.userId !== 'string' || !body.userId) {
      return NextResponse.json(
        { ok: false, error: 'userId is required' },
        { status: 400 },
      );
    }
    const userId = body.userId;

    // Validate role (if provided).
    let role: string | undefined;
    if (body.role !== undefined && body.role !== null) {
      if (typeof body.role !== 'string' || !(body.role in ROLE_PRESETS)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid role' },
          { status: 400 },
        );
      }
      role = body.role;
    }

    // Validate sections (if provided). null → clear override; array → validate.
    let sectionsProvided = false;
    let sections: string[] | null = null;
    if (body.sections !== undefined) {
      sectionsProvided = true;
      if (body.sections === null) {
        sections = null;
      } else if (Array.isArray(body.sections)) {
        const arr = body.sections;
        if (!arr.every((s) => typeof s === 'string' && SECTION_SET.has(s))) {
          return NextResponse.json(
            { ok: false, error: 'Invalid sections' },
            { status: 400 },
          );
        }
        // De-dupe, keep only valid values.
        sections = Array.from(new Set(arr as string[])).filter((s) =>
          SECTION_SET.has(s),
        );
      } else {
        return NextResponse.json(
          { ok: false, error: 'sections must be an array or null' },
          { status: 400 },
        );
      }
    }

    const client = await clerkClient();

    // Read existing metadata so we merge rather than clobber unrelated keys.
    const user = await client.users.getUser(userId);
    const existing = { ...(user.publicMetadata as Record<string, unknown>) };

    if (role !== undefined) existing.role = role;

    if (sectionsProvided) {
      if (sections === null) delete existing.sections;
      else existing.sections = sections;
    }

    await client.users.updateUser(userId, { publicMetadata: existing });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 },
    );
  }
}
