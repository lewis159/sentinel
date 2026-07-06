import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Auth-only middleware, matching the YT app's known-good pattern. Unauthenticated
// users hitting a protected route are redirected to sign-in. Per-app authorization
// (global_admin) is enforced server-side in the API routes (requireOpsAuth) and at
// the page level (requireGlobalAdminPage) — NOT here — to avoid the @clerk/nextjs +
// Next 15 "encryption_key_invalid" issue seen when extra options/logic run here.
//
// Public routes:
//   - /sign-in(.*)            : the sign-in page
//   - /api/ping               : container liveness healthcheck
//   - /api/ops/ingest/(.*)    : webhook-in scanners, HMAC-verified in-route
//   - /api/ingest/issue       : estate-app report-issue widget (token/HMAC in-route)
//   - /api/ingest/alerts      : Grafana/Alertmanager alert-ingest → incidents (token/HMAC in-route)
//   - /api/ingest/update      : agent/system ticket-update append (token/HMAC in-route)
//   - /api/ingest/roadmap     : agent/CI roadmap-item upsert (token/HMAC in-route)
//   - /api/ingest/changelog   : agent/CI changelog-entry append (token/HMAC in-route)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ping',
  '/api/ops/ingest/(.*)',
  '/api/ingest/issue',
  '/api/ingest/alerts',
  '/api/ingest/update',
  '/api/ingest/roadmap',
  '/api/ingest/changelog',
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
