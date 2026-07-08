import { auth, clerkClient } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { resolveSections, hasSection, type Section } from '@/lib/v2/rbac';

// ---------------------------------------------------------------------------
// TEST-ONLY E2E auth bypass — DOUBLE-GATED, inert in production.
//
// Enabled ONLY when BOTH hold:
//   - process.env.E2E_TEST_MODE === '1'   (opt-in, set by the Playwright runner)
//   - process.env.NODE_ENV !== 'production'  (so a prod build ALWAYS ignores it,
//     even if the env var leaks into the environment).
//
// When active, getSessionRole()/getSessionAccess() return a synthetic identity
// (userId 'e2e') instead of touching Clerk — letting the Playwright suite drive
// the app without a real Clerk session. Optional request headers tune it:
//   - x-e2e-role      → the role (default 'global_admin')
//   - x-e2e-sections  → comma-separated section override (optional)
// This flag MUST stay false in every real deployment.
// ---------------------------------------------------------------------------
export function e2eBypass(): boolean {
  return process.env.E2E_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
}

// Phase-0 authorization: gate EVERYTHING behind a single role. The
// ops_viewer / responder / admin split comes later.
//
// The authorization role is read from Clerk `publicMetadata.role` — the shared
// estate convention. Sentinel has no Supabase `users` table dependency, so
// unlike the YT app (which reads `users.role` from Supabase) we read the role
// straight off the Clerk session claims.
const GLOBAL_ADMIN = 'global_admin';

async function getSessionRole(): Promise<{ userId: string | null; role: unknown }> {
  // TEST-ONLY shim (double-gated, see e2eBypass): synthetic admin from headers.
  if (e2eBypass()) {
    const h = await headers();
    return { userId: 'e2e', role: h.get('x-e2e-role') || GLOBAL_ADMIN };
  }

  const { userId, sessionClaims } = await auth();
  if (!userId) return { userId: null, role: undefined };
  // Fast path: role from the session token's publicMetadata claim (requires the
  // "Customize session token" claim). Fallback: look the user up via the Clerk
  // API so this works even without that claim configured.
  let role = (sessionClaims?.publicMetadata as { role?: unknown } | undefined)?.role;
  if (role === undefined) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      role = (user.publicMetadata as { role?: unknown } | undefined)?.role;
    } catch {
      /* leave role undefined → treated as not authorized */
    }
  }
  return { userId, role };
}

/**
 * Call as the FIRST line of every mutating / data API route handler.
 * Mirrors app-ha's `requireAdmin()` "return denied || proceed" shape:
 *   const denied = await requireOpsAuth();
 *   if (denied) return denied;
 *
 * Returns:
 *   - 401 NextResponse if the caller is not signed in
 *   - 403 NextResponse if signed in but not a global_admin
 *   - null if the caller is a global_admin (proceed)
 */
export async function requireOpsAuth(): Promise<NextResponse | null> {
  const { userId, role } = await getSessionRole();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (role !== GLOBAL_ADMIN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

/**
 * Call at the top of a server component / page that must be gated.
 * Redirects:
 *   - to /sign-in     if not signed in
 *   - to /unauthorized if signed in but not a global_admin
 */
export async function requireGlobalAdminPage(): Promise<void> {
  const { userId, role } = await getSessionRole();

  if (!userId) {
    redirect('/sign-in');
  }

  if (role !== GLOBAL_ADMIN) {
    redirect('/unauthorized');
  }
}

// ---------------------------------------------------------------------------
// Sentinel v2 — section-level access control.
//
// Layers the pure `@/lib/v2/rbac` helpers on top of the Clerk session. Reads
// `publicMetadata.role` AND `publicMetadata.sections` (a string[] override) via
// the same fast-path (session claims) + clerkClient fallback used by
// getSessionRole above.
// ---------------------------------------------------------------------------

/**
 * Like getSessionRole, but also resolves the optional `publicMetadata.sections`
 * override. `role` is coerced to string | undefined.
 */
export async function getSessionAccess(): Promise<{
  userId: string | null;
  role: string | undefined;
  sections?: string[];
}> {
  // TEST-ONLY shim (double-gated, see e2eBypass): synthetic admin from headers.
  // x-e2e-role (default 'global_admin') + optional comma-separated x-e2e-sections.
  if (e2eBypass()) {
    const h = await headers();
    const rawSections = h.get('x-e2e-sections');
    const sections = rawSections
      ? rawSections.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    return { userId: 'e2e', role: h.get('x-e2e-role') || GLOBAL_ADMIN, sections };
  }

  const { userId, sessionClaims } = await auth();
  if (!userId) return { userId: null, role: undefined };

  const meta = sessionClaims?.publicMetadata as
    | { role?: unknown; sections?: unknown }
    | undefined;

  let role: unknown = meta?.role;
  let sections: unknown = meta?.sections;

  // Fallback to the Clerk API when either value is missing from the session
  // token (e.g. the "Customize session token" claim isn't configured).
  if (role === undefined || sections === undefined) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const pub = user.publicMetadata as
        | { role?: unknown; sections?: unknown }
        | undefined;
      if (role === undefined) role = pub?.role;
      if (sections === undefined) sections = pub?.sections;
    } catch {
      /* leave whatever we have → treated as least privilege */
    }
  }

  return {
    userId,
    role: typeof role === 'string' ? role : undefined,
    sections: Array.isArray(sections)
      ? sections.filter((s): s is string => typeof s === 'string')
      : undefined,
  };
}

/**
 * Call at the top of a v2 server component / page that must be gated by
 * section. Redirects:
 *   - to /sign-in            if not signed in
 *   - to /v2/unauthorized    if signed in but lacks the section
 */
export async function requireSectionPage(section: Section): Promise<void> {
  const { userId, role, sections } = await getSessionAccess();

  if (!userId) {
    redirect('/sign-in');
  }

  if (!hasSection(role, sections, section)) {
    redirect('/v2/unauthorized');
  }
}

/**
 * Call as the FIRST line of a v2 API route handler that must be gated by
 * section. Returns:
 *   - 401 NextResponse if not signed in
 *   - 403 NextResponse if signed in but lacks the section
 *   - null             if permitted (proceed)
 */
export async function requireSectionApi(
  section: Section,
): Promise<NextResponse | null> {
  const { userId, role, sections } = await getSessionAccess();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasSection(role, sections, section)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

// Re-export for convenience so callers can import resolveSections from either
// module (used by the v2 unauthorized page).
export { resolveSections };
