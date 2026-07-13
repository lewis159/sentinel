// Customer self-service portal — the single auth/session choke-point.
//
// EVERY portal page and API route calls requirePortalSession() (pages) or
// getPortalSession() (APIs) as their first line. The tenant is derived HERE,
// from the SERVER session only, and passed down to the tenant-scoped data layer
// — a client can never influence which tenant's data it sees.
//
// Tenant rule (differs from lib/auth.ts getSessionTenant on purpose):
//   * The portal tenant is ALWAYS the caller's ACTIVE Clerk org (orgId).
//   * This holds even for a global_admin operator who happens to be signed in —
//     getSessionTenant() nulls the tenant for operators (they see everything in
//     the ops console), which is exactly what we must NOT do on a customer
//     surface. Here an operator viewing the portal is scoped to their active
//     org like anyone else. No active org → no access, never cross-tenant.

import { auth, currentUser } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { e2eBypass } from '@/lib/auth';

export type PortalSession = {
  userId: string;
  tenantRef: string;
  email: string | null;
};

// Resolve the portal session without redirecting. Returns null when there is no
// signed-in user OR no active tenant (org) — the caller decides how to respond
// (a page redirects; an API returns 401/403).
export async function getPortalSession(): Promise<PortalSession | null> {
  // TEST-ONLY shim (double-gated, see e2eBypass): synthetic identity from
  // x-e2e-user / x-e2e-org headers so Playwright can drive the portal without a
  // real Clerk session. Inert in production.
  if (e2eBypass()) {
    const h = await headers();
    const userId = h.get('x-e2e-user') || 'e2e';
    const org = h.get('x-e2e-org');
    if (!org) return null; // no tenant → treated as "no access"
    return { userId, tenantRef: org, email: h.get('x-e2e-email') };
  }

  const { userId, orgId } = await auth();
  if (!userId) return null;
  if (!orgId) return null; // signed in but no active org → no tenant → no access

  let email: string | null = null;
  try {
    const u = await currentUser();
    email = u?.emailAddresses?.[0]?.emailAddress ?? null;
  } catch {
    /* email is cosmetic; absence must not block the session */
  }

  return { userId, tenantRef: orgId, email };
}

// Page guard. Redirects:
//   * to /sign-in            when not signed in
//   * to /portal/no-access   when signed in but without an active tenant/org
// Returns the resolved session (guaranteed non-null) otherwise.
export async function requirePortalSession(): Promise<PortalSession> {
  const { userId } = await (async () => {
    if (e2eBypass()) {
      const h = await headers();
      return { userId: h.get('x-e2e-user') || 'e2e' };
    }
    return auth();
  })();

  if (!userId) redirect('/sign-in');

  const session = await getPortalSession();
  if (!session) redirect('/portal/no-access');
  return session;
}
