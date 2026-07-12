import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

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
//   - /api/ingest/email       : inbound-email → ticket (OPS_EMAIL_TOKEN token/HMAC in-route)
//   - /api/public/support/(.*): customer support-chat widget + L0 KB search (OPS_SUPPORT_TOKEN in-route)
//   - /api/public/leads       : public lead-capture form (OPS_SUPPORT_TOKEN token/HMAC in-route)
//   - /api/bot/(.*)           : Discord bot surface (OPS_BOT_TOKEN token/HMAC in-route)
//   - /api/inngest(.*)        : self-hosted Inngest server↔app sync/invoke (Inngest request-signature verified in-handler)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/ping',
  '/api/ops/ingest/(.*)',
  '/api/ingest/issue',
  '/api/ingest/alerts',
  '/api/ingest/update',
  '/api/ingest/roadmap',
  '/api/ingest/changelog',
  '/api/ingest/email',
  '/api/public/support/(.*)',
  '/api/public/leads',
  '/api/bot/(.*)',
  '/api/inngest(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // TEST-ONLY E2E bypass — DOUBLE-GATED, inert in production. Active only when
  // process.env.E2E_TEST_MODE === '1' AND NODE_ENV !== 'production' (a prod build
  // ignores it even if the env var leaks). Skips the Clerk auth/redirect guard so
  // the Playwright suite renders the app without a real session, while still
  // stamping x-sentinel-shell=v2 for /v2 paths (mirrors the logic below). Real
  // deployments never set E2E_TEST_MODE, so normal behavior is unchanged.
  if (process.env.E2E_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') {
    if (req.nextUrl.pathname.startsWith('/v2')) {
      const headers = new Headers(req.headers);
      headers.set('x-sentinel-shell', 'v2');
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }

  if (!isPublicRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) {
      return redirectToSignIn();
    }
  }

  // Additive v2 shell signal: tag requests under /v2 with a header the root
  // layout reads to swap in the parallel v2 shell. v1 paths are untouched.
  if (req.nextUrl.pathname.startsWith('/v2')) {
    const headers = new Headers(req.headers);
    headers.set('x-sentinel-shell', 'v2');
    return NextResponse.next({ request: { headers } });
  }
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
