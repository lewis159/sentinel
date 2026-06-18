import { clerkClient, clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Public routes — no auth at all.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ping',
  '/api/ops/ingest/(.*)',
]);

// API routes get JSON 401/403 instead of HTML redirects.
const isApiRoute = createRouteMatcher(['/api/(.*)']);

// /unauthorized must render for signed-in NON-admins (the role-denied target).
const isUnauthorizedRoute = createRouteMatcher(['/unauthorized']);

// Estate subdomains sharing the bentech.dev Clerk instance (azp validation).
const AUTHORIZED_PARTIES = [
  'https://yt.bentech.dev',
  'https://ops.bentech.dev',
  'http://localhost:3000',
];

const GLOBAL_ADMIN = 'global_admin';

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    const { userId, sessionClaims, redirectToSignIn } = await auth();

    // 1) Authentication.
    if (!userId) {
      if (isApiRoute(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return redirectToSignIn();
    }

    // Signed-in users may reach /unauthorized so the role-denied page renders.
    if (isUnauthorizedRoute(req)) return;

    // 2) Authorization (Phase-0): must be global_admin.
    // Fast path: read role from the session token's publicMetadata claim (needs
    // the "Customize session token" claim). Fallback: look the user up via the
    // Clerk API, so the gate works even without that claim configured.
    let role = (sessionClaims as { publicMetadata?: { role?: unknown } } | null)?.publicMetadata?.role;
    let roleSource = 'session';
    if (role === undefined) {
      try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        role = (user.publicMetadata as { role?: unknown } | undefined)?.role;
        roleSource = 'api';
      } catch {
        roleSource = 'api-error';
      }
    }

    if (role !== GLOBAL_ADMIN) {
      if (isApiRoute(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }
  },
  { authorizedParties: AUTHORIZED_PARTIES },
);

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
