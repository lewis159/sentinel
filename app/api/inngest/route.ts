// Inngest serve endpoint (Next.js App Router).
//
// This is the URL the self-hosted Inngest server calls to (a) SYNC/discover our
// functions (PUT) and (b) INVOKE them step-by-step (POST). It must be reachable
// at /api/inngest for the server's auto-sync to work.
//
// FLAG-GATED: when HERMES_INNGEST_ENABLED is off (the default), every method
// returns 503 and NO functions are served — so the server can never sync or run
// anything, and the app is completely unaffected before the Inngest server exists.
// When on, requests are handled by the SDK's `serve` handler (signature-verified
// with INNGEST_SIGNING_KEY by the SDK itself).
//
// This route is exempted from Clerk auth in middleware.ts (public matcher entry
// '/api/inngest(.*)') because the server↔app calls are signed by Inngest, not by a
// Clerk session — mirroring how the other machine-to-machine ingest routes are
// handled. Authenticity is enforced by the Inngest request signature in-handler.
import { serve } from 'inngest/next';
import { inngest, inngestEnabled } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

export const dynamic = 'force-dynamic';

// Build the SDK handler once. When the flag is off we hand it an EMPTY function
// list (nothing to sync) AND short-circuit each method below — belt and braces.
const handlers = serve({
  client: inngest,
  functions: inngestEnabled() ? functions : [],
});

function disabled(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      disabled: true,
      error: 'Inngest is disabled — set HERMES_INNGEST_ENABLED=1 to enable the serve endpoint.',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );
}

// Forward the SDK handler's full argument list (Next passes req + route context)
// so the signatures match exactly; the disabled path just ignores them.
export function GET(...args: Parameters<typeof handlers.GET>): Response | Promise<Response> {
  return inngestEnabled() ? handlers.GET(...args) : disabled();
}

export function POST(...args: Parameters<typeof handlers.POST>): Response | Promise<Response> {
  return inngestEnabled() ? handlers.POST(...args) : disabled();
}

export function PUT(...args: Parameters<typeof handlers.PUT>): Response | Promise<Response> {
  return inngestEnabled() ? handlers.PUT(...args) : disabled();
}
