import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Public routes — no auth at all.
//   - /sign-in(.*)         : the sign-in page itself
//   - /api/ping            : container liveness healthcheck
//   - /api/ops/ingest/(.*) : webhook-in scanners, HMAC-verified in-route (the
//                            signer has no Clerk cookie — do NOT Clerk-gate)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ping',
  '/api/ops/ingest/(.*)',
]);

// API routes get JSON 401/403 instead of HTML redirects.
const isApiRoute = createRouteMatcher(['/api/(.*)']);

// /unauthorized must render for signed-in NON-admins (it's the role-denied
// redirect target) — gate it on being signed in, not on the role.
const isUnauthorizedRoute = createRouteMatcher(['/unauthorized']);

// Estate subdomains that share the bentech.dev Clerk instance. Clerk validates
// the session's `azp` against this list — hardening for the multi-subdomain
// setup. Add each new *.bentech.dev app here as it onboards.
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

    // 1) Authentication — must be signed in.
    if (!userId) {
      if (isApiRoute(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return redirectToSignIn();
    }

    // Signed-in users may reach /unauthorized so the role-denied page renders.
    if (isUnauthorizedRoute(req)) return;

    // 2) Authorization (Phase-0) — must be global_admin. Role is read from the
    // session token's publicMetadata claim (requires the "Customize session
    // token" claim { "publicMetadata": "{{user.public_metadata}}" } on the
    // SAME Clerk instance these keys belong to — dev instance for localhost).
    const role = (sessionClaims?.publicMetadata as { role?: unknown } | undefined)?.role;
    if (role !== GLOBAL_ADMIN) {
      if (isApiRoute(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }
  },
  { authorizedParties: AUTHORIZED_PARTIES },
);

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
