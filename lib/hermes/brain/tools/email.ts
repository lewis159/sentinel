// sendEmail action tool for the Brain — the Support / CFO copilots' real outbound
// email path, sent via Resend's REST API.
//
//   sendEmail (GATED) — send a transactional email via Resend.
//
// GATED: sending on the estate's behalf is a real side-effect, so it only runs
// AFTER a human approves the proposal in the Sentinel Approvals queue — the graph
// interrupts on gated tools and the generic resume path calls run() exactly once.
// There is NO auto-send path here.
//
// Config: the Resend API key is read from the env var named exactly `RESEND_API`
// (confirmed key name in the vault — NOT `RESEND_API_KEY`). We also try Infisical
// getSecret('RESEND_API') as a fallback. The key is NEVER hardcoded and NEVER
// logged. Missing key → a clear "not configured" result (never an unhandled throw).
// A default From address can be supplied via `RESEND_FROM` when the caller omits one.
import 'server-only';
import { z } from 'zod';
import { getSecret } from '@/lib/secrets';
import type { BrainTool } from './types';

const RESEND_API_URL = 'https://api.resend.com/emails';

// RESEND_API (exact name): env first, then Infisical fallback.
async function resendKey(): Promise<string | undefined> {
  return process.env.RESEND_API || (await getSecret('RESEND_API')) || undefined;
}

const NOT_CONFIGURED = 'Email not configured — set the RESEND_API env var (the Resend API key) to enable sending.';

const schema = z
  .object({
    to: z
      .union([z.string(), z.array(z.string()).min(1)])
      .describe('Recipient email address, or an array of addresses.'),
    subject: z.string().min(1).describe('The email subject line.'),
    text: z.string().optional().describe('Plain-text body. Provide text and/or html.'),
    html: z.string().optional().describe('HTML body. Provide text and/or html.'),
    from: z
      .string()
      .optional()
      .describe('From address, e.g. "Sentinel <ops@bentech.dev>". Defaults to the RESEND_FROM env var.'),
    replyTo: z.string().optional().describe('Optional Reply-To address.'),
  })
  .refine((a) => Boolean(a.text || a.html), { message: 'Provide a text and/or html body.' });
export type SendEmailArgs = z.infer<typeof schema>;

export const sendEmailTool: BrainTool<SendEmailArgs> = {
  name: 'sendEmail',
  description:
    'Send a transactional email via Resend (to / subject / text|html / from). This sends real mail on the estate\'s behalf, so it requires human approval before it runs.',
  schema,
  autonomy: 'gated',
  describeCall: (a) => {
    const to = Array.isArray(a.to) ? a.to.join(', ') : a.to;
    return `Email to ${to} — subject "${a.subject.slice(0, 80)}"`;
  },
  run: async ({ to, subject, text, html, from, replyTo }) => {
    const key = await resendKey();
    if (!key) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const fromAddr = from || process.env.RESEND_FROM;
    if (!fromAddr) {
      return {
        ok: false,
        summary: 'No From address — pass `from` or set the RESEND_FROM env var.',
        error: 'not_configured',
      };
    }

    const payload: Record<string, unknown> = {
      from: fromAddr,
      to: Array.isArray(to) ? to : [to],
      subject,
    };
    if (text) payload.text = text;
    if (html) payload.html = html;
    if (replyTo) payload.reply_to = replyTo;

    try {
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (body as any)?.message || `Resend API error (HTTP ${res.status})`;
        return { ok: false, summary: `Email failed: ${msg}`, error: 'resend_error' };
      }
      const id = (body as any)?.id;
      const toLabel = Array.isArray(to) ? to.join(', ') : to;
      return {
        ok: true,
        summary: `Email sent to ${toLabel} — subject "${subject}" (id ${id ?? 'n/a'}).`,
        data: { id, to: payload.to, subject },
      };
    } catch (e: any) {
      return { ok: false, summary: `Email send failed: ${e?.message ?? 'network error'}`, error: 'network_error' };
    }
  },
};
