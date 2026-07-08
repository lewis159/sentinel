// Shared plumbing for the token-gated `/api/bot/*` surface (the Discord bot).
//
// Every bot route follows the same shape as the ingest routes: read the RAW body
// once (so an HMAC is verified over exact bytes), verify the BOT tier
// (OPS_BOT_TOKEN, token or HMAC — see lib/ingest-auth.ts), then delegate to the
// same lib/data.ts / lib/hermes/* functions the Clerk web routes use. This module
// factors out the CORS + JSON + auth boilerplate so the routes stay thin and
// consistent, without duplicating any business logic.

import { verifyBotIngest } from '@/lib/ingest-auth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, x-ingest-token, x-ingest-signature, Authorization',
};

export function botJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

export function botOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// Verify the BOT tier and hand back the raw body (already consumed) so the caller
// can JSON.parse it. Returns a ready-to-send error Response when auth fails.
export async function authBot(
  req: Request,
): Promise<{ ok: true; raw: string } | { ok: false; res: Response }> {
  const raw = await req.text();
  const authed = verifyBotIngest(req, raw);
  if (!authed.ok) {
    return { ok: false, res: botJson({ error: authed.error }, authed.status) };
  }
  return { ok: true, raw };
}

// Resolve the audit actor label for a bot-initiated write. The bot passes the
// Discord username in `author`; we namespace it so the web console's timeline can
// tell bot-origin actions apart from operator actions. Falls back to 'discord'.
export function botActor(author?: unknown): string {
  const name = typeof author === 'string' ? author.trim() : '';
  if (!name) return 'discord';
  return name.startsWith('discord:') ? name : `discord:${name}`;
}
