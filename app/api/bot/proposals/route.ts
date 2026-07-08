// Bot Hermes-proposal feed — the approval queue the bot polls to surface pending
// proposals as Discord embeds with Approve/Dismiss buttons.
//
// Token-gated (BOT tier). Reads the SAME ops.hermes_proposals the web queue reads
// via listProposals(). Empty (live:false) with no DB.
//
//   GET /api/bot/proposals?status=pending&limit=50
//   → 200 { proposals: HermesProposalRecord[], live: boolean }

import { hasDb } from '@/lib/db';
import { listProposals } from '@/lib/hermes/proposals';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return botOptions();
}

export async function GET(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;

  const proposals = await listProposals({ status, limit });
  return botJson({ proposals, live: hasDb });
}
