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
//   - /api/hermes/channels/(.*): external messaging surfaces (Telegram webhook — X-Telegram-Bot-Api-Secret-Token verified in-route)
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
  '/api/hermes/channels/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // TEST-ONLY E2E bypass — DOUBLE-GATED, inert in production. Active only when
  // process.env.E2E_TEST_MODE === '1' AND NODE_ENV !== 'production' (a prod build
  // ignores it even if the env var leaks). Skips the Clerk auth/redirect guard so
  // the Playwright suite renders the app without a real session, while still
  // stamping x-sentinel-shell=v2 for /v2 paths (mirrors the logic below). Real
  // deployments never set E2E_TEST_MODE, so normal behavior is unchanged.
  if (process.env.E2E_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') {
    const shell = shellFor(req.nextUrl.pathname);
    if (shell) {
      const headers = new Headers(req.headers);
      headers.set('x-sentinel-shell', shell);
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

  // v1 RETIREMENT: v2 is the only console. Every legacy v1 route 308-redirects
  // to its v2 equivalent (permanent — safe to cache). Routes with a same-name v2
  // twin map to /v2/<same>; v1-only routes map to the nearest v2 hub. The check
  // runs on the FIRST path segment and never touches /v2, /portal, /api,
  // /sign-in, /unauthorized, _next, or static files (those are excluded below).
  const redirect = v1RedirectFor(req.nextUrl.pathname);
  if (redirect) {
    // Carry the original query string across the redirect.
    return NextResponse.redirect(new URL(redirect + req.nextUrl.search, req.url), 308);
  }

  // Additive shell signal: tag requests under /v2 (operator v2 shell) or /portal
  // (customer portal shell) with a header the root layout reads to render
  // {children} bare — each supplies its own shell.
  const shell = shellFor(req.nextUrl.pathname);
  if (shell) {
    const headers = new Headers(req.headers);
    headers.set('x-sentinel-shell', shell);
    return NextResponse.next({ request: { headers } });
  }
});

// Legacy v1 route → v2 target, keyed by first path segment. Routes with a
// same-name v2 twin redirect to /v2/<same>; v1-only routes redirect to the
// nearest v2 hub. Root ('') → /v2.
const V1_REDIRECTS: Record<string, string> = {
  // v1 routes with a same-name v2 twin → /v2/<same>
  access: '/v2/access',
  activity: '/v2/activity',
  alerts: '/v2/alerts',
  changelog: '/v2/changelog',
  changes: '/v2/changes',
  components: '/v2/components',
  graph: '/v2/graph',
  incidents: '/v2/incidents',
  kb: '/v2/kb',
  problems: '/v2/problems',
  releases: '/v2/releases',
  reports: '/v2/reports',
  requests: '/v2/requests',
  resilience: '/v2/resilience',
  roadmap: '/v2/roadmap',
  scans: '/v2/scans',
  settings: '/v2/settings',
  // v1-only routes (no same-name v2 twin) → nearest v2 hub
  tickets: '/v2/support',
  users: '/v2/access',
  account: '/v2/settings',
  findings: '/v2/security',
  infra: '/v2/operations',
  monitoring: '/v2/operations',
  status: '/v2/operations',
};

// Compute the v2 redirect target for a legacy v1 path, or null if the path is
// not a retired v1 route. Preserves any sub-path/query beyond the first segment
// (e.g. /findings/F-12?x=1 → /v2/security/F-12?x=1). Never matches paths owned
// by a live shell/route: /v2, /portal, /api, /sign-in, /unauthorized (the
// matcher already excludes _next and static files).
function v1RedirectFor(pathname: string): string | null {
  if (
    pathname.startsWith('/v2') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/unauthorized')
  ) {
    return null;
  }
  const segs = pathname.split('/').filter(Boolean); // '/foo/bar' → ['foo','bar']
  const first = segs[0] ?? ''; // '' for the root path '/'
  if (first === '') return '/v2';
  const target = V1_REDIRECTS[first];
  if (!target) return null;
  const rest = segs.slice(1).join('/'); // sub-path after the first segment
  return rest ? `${target}/${rest}` : target;
}

// Which parallel shell (if any) owns this path. Kept in one place so the E2E and
// normal branches stay in step. Returns null for v1/operator paths.
function shellFor(pathname: string): 'v2' | 'portal' | null {
  if (pathname.startsWith('/v2')) return 'v2';
  if (pathname.startsWith('/portal')) return 'portal';
  return null;
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
