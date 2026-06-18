import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public routes — everything else is gated behind a signed-in Clerk session.
//   - /sign-in(.*)            : the sign-in page itself
//   - /api/ping               : container liveness healthcheck (no auth)
//   - /api/ops/ingest/(.*)    : webhook-in scanners, HMAC-verified in-route —
//                               do NOT also Clerk-gate, the signer has no cookie.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ping',
  '/api/ops/ingest/(.*)',
]);

// Estate subdomains that share the bentech.dev Clerk instance. Clerk validates
// the session's `azp` (authorized party) against this list, so only these origins
// can use the shared session — hardening for a multi-subdomain setup. Add each new
// *.bentech.dev app here as it onboards (localhost included for dev).
const AUTHORIZED_PARTIES = [
  'https://yt.bentech.dev',
  'https://ops.bentech.dev',
  'http://localhost:3000',
];

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      const { userId, redirectToSignIn } = await auth();
      if (!userId) {
        return redirectToSignIn();
      }
    }
  },
  { authorizedParties: AUTHORIZED_PARTIES },
);

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
