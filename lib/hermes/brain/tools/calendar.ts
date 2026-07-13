// Google Calendar tools for the Brain — the PA's personal-ops calendar path.
//
//   listUpcomingEvents (auto)  — read the next N events on the primary calendar.
//   createCalendarEvent (GATED) — create an event (summary/start/end/attendees).
//
// GATED: creating an event puts something on Ben's real calendar (and can invite
// attendees), so it only ever runs AFTER a human approves the proposal in the
// Sentinel Approvals queue — the graph interrupts on gated tools and the generic
// resume path calls run() exactly once. There is NO auto-create path here.
//
// Auth: the Google access token comes from lib/pa/google (env → Infisical →
// refresh). Missing token → a clean `not_configured` result (never a throw).
import 'server-only';
import { z } from 'zod';
import type { BrainTool } from './types';
import {
  getGoogleAccessToken,
  googleFetch,
  googleError,
  PA_GOOGLE_NOT_CONFIGURED,
} from '@/lib/pa/google';

const CAL_API = 'https://www.googleapis.com/calendar/v3';

function eventTime(e: any): string | undefined {
  return e?.start?.dateTime || e?.start?.date;
}

// ---------- listUpcomingEvents (auto / read) ----------
const listSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe('How many upcoming events to return (default 10).'),
  calendarId: z
    .string()
    .optional()
    .describe('Calendar id to read; defaults to "primary".'),
});

export const listUpcomingEventsTool: BrainTool<z.infer<typeof listSchema>> = {
  name: 'listUpcomingEvents',
  description:
    "Read the next few events on Ben's Google Calendar (summary, start, end, location, attendees). Safe read — use for \"what's on today / this week\" before proposing anything.",
  schema: listSchema,
  autonomy: 'auto',
  run: async ({ maxResults, calendarId }) => {
    const token = await getGoogleAccessToken();
    if (!token) return { ok: false, summary: PA_GOOGLE_NOT_CONFIGURED, error: 'not_configured' };
    const cal = calendarId || 'primary';
    const n = maxResults ?? 10;
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      maxResults: String(n),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const r = await googleFetch(
      `${CAL_API}/calendars/${encodeURIComponent(cal)}/events?${params.toString()}`,
      token,
    );
    if (!r.ok) return { ok: false, summary: `Could not read calendar: ${googleError(r)}`, error: 'google_error' };
    const items = (r.body?.items ?? []).map((e: any) => ({
      id: e.id,
      summary: e.summary ?? '(no title)',
      start: eventTime(e),
      end: e?.end?.dateTime || e?.end?.date,
      location: e.location,
      attendees: (e.attendees ?? []).map((a: any) => a.email).filter(Boolean),
      htmlLink: e.htmlLink,
    }));
    if (items.length === 0) return { ok: true, summary: 'No upcoming events.', data: [] };
    const lines = items
      .map((e: any) => `${e.start ?? '?'} — ${e.summary}${e.location ? ` @ ${e.location}` : ''}`)
      .join('\n');
    return { ok: true, summary: `${items.length} upcoming event(s):\n${lines}`, data: items };
  },
};

// ---------- createCalendarEvent (GATED / calendar write) ----------
const createSchema = z.object({
  summary: z.string().min(1).describe('The event title, e.g. "Call with Acme".'),
  start: z
    .string()
    .min(1)
    .describe('Start time as an RFC3339 timestamp (e.g. 2026-07-14T15:00:00+01:00) or a YYYY-MM-DD date for an all-day event.'),
  end: z
    .string()
    .min(1)
    .describe('End time as an RFC3339 timestamp, or a YYYY-MM-DD date for an all-day event.'),
  description: z.string().optional().describe('Optional event body / notes.'),
  location: z.string().optional().describe('Optional location.'),
  attendees: z
    .array(z.string())
    .optional()
    .describe('Optional attendee email addresses to invite.'),
  calendarId: z.string().optional().describe('Calendar id to write to; defaults to "primary".'),
});
export type CreateCalendarEventArgs = z.infer<typeof createSchema>;

// An all-day date (YYYY-MM-DD) uses the {date} form; a full timestamp uses {dateTime}.
function timePayload(v: string): Record<string, string> {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { date: v } : { dateTime: v };
}

export const createCalendarEventTool: BrainTool<CreateCalendarEventArgs> = {
  name: 'createCalendarEvent',
  description:
    "Create an event on Ben's Google Calendar (title, start, end, optional attendees/location/notes). This puts a real event on his calendar and can invite people, so it requires human approval before it runs.",
  schema: createSchema,
  autonomy: 'gated',
  describeCall: (a) =>
    `Calendar event "${a.summary}" ${a.start} → ${a.end}${a.attendees?.length ? ` (invite ${a.attendees.join(', ')})` : ''}`,
  run: async ({ summary, start, end, description, location, attendees, calendarId }) => {
    const token = await getGoogleAccessToken();
    if (!token) return { ok: false, summary: PA_GOOGLE_NOT_CONFIGURED, error: 'not_configured' };
    const cal = calendarId || 'primary';
    const body: Record<string, unknown> = {
      summary,
      start: timePayload(start),
      end: timePayload(end),
    };
    if (description) body.description = description;
    if (location) body.location = location;
    if (attendees && attendees.length) body.attendees = attendees.map((email) => ({ email }));

    const r = await googleFetch(
      `${CAL_API}/calendars/${encodeURIComponent(cal)}/events`,
      token,
      { method: 'POST', body },
    );
    if (!r.ok) return { ok: false, summary: `Could not create event: ${googleError(r)}`, error: 'google_error' };
    const ev = r.body;
    return {
      ok: true,
      summary: `Created "${ev.summary ?? summary}" (${start} → ${end}) — ${ev.htmlLink ?? ev.id ?? 'ok'}.`,
      data: { id: ev.id, summary: ev.summary, start: ev.start, end: ev.end, htmlLink: ev.htmlLink },
    };
  },
};
