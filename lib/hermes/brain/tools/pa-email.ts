// Gmail tools for the Brain — the PA's personal email-triage path.
//
//   listRecentEmail (auto)   — read recent messages' metadata (from/subject/snippet).
//   draftEmailReply (GATED)  — create a Gmail DRAFT (never auto-sends).
//
// The PA's actual SEND path reuses the estate's existing Resend `sendEmail` tool
// (lib/hermes/brain/tools/email.ts) — it's already gated and is the estate's
// outbound path, so we do NOT duplicate a Gmail send here. draftEmailReply stops
// at a Gmail draft: even the draft is GATED (interrupt → proposal → approve →
// create the draft once), so nothing lands in Gmail without Ben's approval.
//
// Auth: the Google access token comes from lib/pa/google (env → Infisical →
// refresh). Missing token → a clean `not_configured` result (never a throw).
// listRecentEmail needs gmail.readonly; draftEmailReply needs gmail.compose.
import 'server-only';
import { z } from 'zod';
import type { BrainTool } from './types';
import {
  getGoogleAccessToken,
  googleFetch,
  googleError,
  PA_GOOGLE_NOT_CONFIGURED,
} from '@/lib/pa/google';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function header(payload: any, name: string): string | undefined {
  const h = (payload?.headers ?? []).find(
    (x: any) => String(x.name).toLowerCase() === name.toLowerCase(),
  );
  return h?.value;
}

// base64url (no padding) — Gmail wants the raw RFC822 message url-safe encoded.
function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- listRecentEmail (auto / read) ----------
const listSchema = z.object({
  maxResults: z.number().int().min(1).max(20).optional().describe('How many recent messages to return (default 10).'),
  query: z
    .string()
    .optional()
    .describe('Optional Gmail search query, e.g. "is:unread" or "from:acme.com". Defaults to the inbox.'),
});

export const listRecentEmailTool: BrainTool<z.infer<typeof listSchema>> = {
  name: 'listRecentEmail',
  description:
    "Read recent Gmail messages for Ben (from, subject, snippet, date) — optionally filtered by a Gmail search query. Safe read — use for inbox triage / \"anything need me?\" before proposing a reply.",
  schema: listSchema,
  autonomy: 'auto',
  run: async ({ maxResults, query }) => {
    const token = await getGoogleAccessToken();
    if (!token) return { ok: false, summary: PA_GOOGLE_NOT_CONFIGURED, error: 'not_configured' };
    const n = maxResults ?? 10;
    const params = new URLSearchParams({ maxResults: String(n) });
    if (query) params.set('q', query);
    else params.set('labelIds', 'INBOX');

    const listRes = await googleFetch(`${GMAIL_API}/messages?${params.toString()}`, token);
    if (!listRes.ok) return { ok: false, summary: `Could not read mail: ${googleError(listRes)}`, error: 'google_error' };
    const ids: string[] = (listRes.body?.messages ?? []).map((m: any) => m.id).filter(Boolean).slice(0, n);
    if (ids.length === 0) return { ok: true, summary: 'No matching messages.', data: [] };

    // Bounded metadata fetch — subject/from/date headers + snippet only (no bodies).
    const metaParams = 'format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date';
    const messages = await Promise.all(
      ids.map(async (id) => {
        const r = await googleFetch(`${GMAIL_API}/messages/${encodeURIComponent(id)}?${metaParams}`, token);
        if (!r.ok) return null;
        const m = r.body;
        return {
          id: m.id,
          threadId: m.threadId,
          from: header(m.payload, 'From'),
          subject: header(m.payload, 'Subject') ?? '(no subject)',
          date: header(m.payload, 'Date'),
          snippet: m.snippet,
        };
      }),
    );
    const clean = messages.filter((m): m is NonNullable<typeof m> => Boolean(m));
    const lines = clean.map((m) => `${m.from ?? '?'} — ${m.subject}`).join('\n');
    return { ok: true, summary: `${clean.length} recent message(s):\n${lines}`, data: clean };
  },
};

// ---------- draftEmailReply (GATED / creates a Gmail draft) ----------
const draftSchema = z.object({
  to: z.string().min(1).describe('Recipient email address.'),
  subject: z.string().min(1).describe('The draft subject line.'),
  body: z.string().min(1).describe('The plain-text draft body.'),
  threadId: z
    .string()
    .optional()
    .describe('Optional Gmail thread id to attach the draft to (for a reply in-thread; from listRecentEmail).'),
  cc: z.string().optional().describe('Optional Cc address.'),
});
export type DraftEmailReplyArgs = z.infer<typeof draftSchema>;

export const draftEmailReplyTool: BrainTool<DraftEmailReplyArgs> = {
  name: 'draftEmailReply',
  description:
    "Create a Gmail DRAFT reply/message (to / subject / body) in Ben's mailbox — it is NOT sent, just saved as a draft for him to review and send. Because it writes to his mailbox it requires human approval before it runs.",
  schema: draftSchema,
  autonomy: 'gated',
  describeCall: (a) => `Draft email to ${a.to} — subject "${a.subject.slice(0, 80)}"`,
  run: async ({ to, subject, body, threadId, cc }) => {
    const token = await getGoogleAccessToken();
    if (!token) return { ok: false, summary: PA_GOOGLE_NOT_CONFIGURED, error: 'not_configured' };

    // Build a minimal RFC822 message. Gmail fills In-Reply-To/References when a
    // threadId is supplied on the draft envelope.
    const lines = [`To: ${to}`];
    if (cc) lines.push(`Cc: ${cc}`);
    lines.push(`Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', body);
    const raw = base64url(lines.join('\r\n'));

    const message: Record<string, unknown> = { raw };
    if (threadId) message.threadId = threadId;

    const r = await googleFetch(`${GMAIL_API}/drafts`, token, { method: 'POST', body: { message } });
    if (!r.ok) return { ok: false, summary: `Could not create draft: ${googleError(r)}`, error: 'google_error' };
    const d = r.body;
    return {
      ok: true,
      summary: `Draft saved to Gmail for ${to} — subject "${subject}" (draft ${d.id ?? 'n/a'}). Review and send in Gmail.`,
      data: { id: d.id, messageId: d.message?.id, threadId: d.message?.threadId, to, subject },
    };
  },
};
