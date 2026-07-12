// broadcastStatus — the PA's delivery-watchdog voice. Posts a short status line
// to the #pa-status channel.
//
// OUTBOUND PATH (investigated): Sentinel's Discord integration is PULL-based — the
// discord-bot process polls /api/bot/* (see discord-bot/src/poller.ts) and Sentinel
// itself holds NO Discord gateway connection. The gateway lives in the bot, which
// Sentinel cannot reach inbound. So the real server-side push to Discord is a
// Discord webhook: DISCORD_PA_STATUS_WEBHOOK, the channel's incoming-webhook URL.
// That IS the wired path (not a placeholder). When it is unset we degrade to a log
// line so a mis-provisioned deploy fails soft instead of erroring the graph.
import 'server-only';
import { z } from 'zod';
import type { BrainTool } from './types';

const schema = z.object({
  text: z.string().min(1).describe('The status line to broadcast (keep it short and scannable).'),
});

async function postToWebhook(url: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) return { ok: false, error: `discord webhook ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'webhook post failed' };
  }
}

export const broadcastStatusTool: BrainTool<z.infer<typeof schema>> = {
  name: 'broadcastStatus',
  description:
    'Post a short status line to the #pa-status broadcast channel (the delivery-watchdog voice). Use for deploy/PR/CI headlines and proactive nudges.',
  schema,
  autonomy: 'auto',
  run: async ({ text }) => {
    const webhook = process.env.DISCORD_PA_STATUS_WEBHOOK;
    if (webhook) {
      const res = await postToWebhook(webhook, text);
      if (!res.ok) return { ok: false, summary: `Failed to broadcast: ${res.error}`, error: res.error };
      return { ok: true, summary: `Broadcast to #pa-status: ${text}`, data: { text, via: 'webhook' } };
    }
    // No webhook configured → log + no-op so the graph continues and callers can
    // still see what WOULD be posted. (Set DISCORD_PA_STATUS_WEBHOOK to go live —
    // that is the real outbound path; there is no bot HTTP inbox to repoint at.)
    // eslint-disable-next-line no-console
    console.log(`[pa-status] (no DISCORD_PA_STATUS_WEBHOOK configured) would broadcast: ${text}`);
    return {
      ok: true,
      summary: `(#pa-status not wired) would broadcast: ${text}`,
      data: { text, via: 'log' },
    };
  },
};
