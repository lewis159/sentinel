import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

// Phase-0 authorization: gate EVERYTHING behind a single role. The
// ops_viewer / responder / admin split comes later.
//
// The authorization role is read from Clerk `publicMetadata.role` — the shared
// estate convention. Sentinel has no Supabase `users` table dependency, so
// unlike the YT app (which reads `users.role` from Supabase) we read the role
// straight off the Clerk session claims.
const GLOBAL_ADMIN = 'global_admin';

async function getSessionRole(): Promise<{ userId: string | null; role: unknown }> {
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
