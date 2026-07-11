// broadcastStatus — the PA's delivery-watchdog voice. Posts a short status line
// to the #pa-status channel.
//
// Sentinel's Discord integration is PULL-based today: the bot polls /api/bot/*
// (see lib/bot-http.ts) and Sentinel does not hold a Discord gateway connection.
// So there is no existing outbound push path to reuse. For P0 we post via a
// Discord webhook URL if one is configured (DISCORD_PA_STATUS_WEBHOOK), else we
// log with a TODO so the wiring is a drop-in later (repoint at the bot's HTTP
// inbox when the bot exposes one — a follow-up).
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
    // TODO: repoint at the Discord bot's HTTP inbox once it exposes an outbound
    // post endpoint (follow-up — Discord bot repoint). For now, log + no-op so the
    // graph continues and callers can still see what WOULD be posted.
    // eslint-disable-next-line no-console
    console.log(`[pa-status] (no DISCORD_PA_STATUS_WEBHOOK configured) would broadcast: ${text}`);
    return {
      ok: true,
      summary: `(#pa-status not wired) would broadcast: ${text}`,
      data: { text, via: 'log' },
    };
  },
};
