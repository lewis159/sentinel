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

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) {
      return redirectToSignIn();
    }
  }
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
