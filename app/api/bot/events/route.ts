// Bot outbound-events feed — the bot polls this to post new/updated tickets
// (incidents, critical findings surfaced as tickets, SLA-relevant changes) to the
// mapped Discord channels.
//
// Token-gated (BOT tier). Returns tickets created OR updated since the `since`
// cursor (ISO). The bot holds the cursor in memory and passes back the `cursor`
// we return; on first run / restart it omits `since` and gets a short lookback so
// it doesn't replay the whole history. Dedupe by ref on the bot side.
//
//   GET /api/bot/events?since=<ISO>&limit=50
//   → 200 { events: [...], cursor: <ISO>, live: boolean }

import { hasDb } from '@/lib/db';
import { getRecentTickets } from '@/lib/data';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

// Default lookback when the bot presents no cursor (first run / restart): 5 min.
const DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;

export async function OPTIONS() {
  return botOptions();
}

export async function GET(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;

  const now = Date.now();
  // Validate the cursor; fall back to the lookback window if absent/garbage.
  let since = new Date(now - DEFAULT_LOOKBACK_MS).toISOString();
  if (sinceParam) {
    const t = Date.parse(sinceParam);
    if (Number.isFinite(t)) since = new Date(t).toISOString();
  }

  const { rows } = await getRecentTickets(since, limit);

  // Shape each ticket into a channel-routable event. `channel` is a logical name
  // the bot maps to a Discord channel id via its env config.
  const events = rows.map((t) => ({
    ref: t.ref,
    kind: t.kind,
    title: t.title,
    status: t.status,
    priority: t.priority,
    app: t.app,
    slaDue: t.slaDue,
    // Incidents (and anything critical) route to #incidents; everything else to
    // the general tickets channel. The bot owns the final channel-id mapping.
    channel: t.kind === 'incident' || t.priority === 'critical' ? 'incidents' : 'tickets',
  }));

  // The new cursor is the newest row's implicit time; since getRecentTickets sorts
  // ascending we advance to "now" — the bot dedupes by ref so a slight overlap is
  // harmless and guarantees no gap between polls.
  const cursor = new Date(now).toISOString();

  return botJson({ events, cursor, live: hasDb });
}
