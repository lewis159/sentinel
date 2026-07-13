import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit tests for the PA Google tools (Calendar + Gmail). We mock global fetch so
// no real Google API is hit, and assert (a) the outbound call shape + Bearer auth
// header, (b) reads are auto / writes are gated, and (c) the missing-token path
// returns a clean `not_configured` ToolResult without calling fetch.
//
// server-only is stubbed (the tools import it). @/lib/secrets.getSecret is stubbed
// to return undefined so the token comes solely from the env var we set here.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/secrets', () => ({ getSecret: vi.fn(async () => undefined) }));

import { listUpcomingEventsTool, createCalendarEventTool } from '@/lib/hermes/brain/tools/calendar';
import { listRecentEmailTool, draftEmailReplyTool } from '@/lib/hermes/brain/tools/pa-email';

const CTX = { threadId: 'test:1', persona: 'pa', actor: 'pa' };

// A fetch mock that records calls and returns a per-call canned JSON response.
// `bodies` is consumed in order; the last entry is reused once exhausted.
function mockFetchSeq(bodies: Array<{ ok?: boolean; status?: number; body?: any }>) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} };
  });
  vi.stubGlobal('fetch', fn as any);
  return fn;
}

beforeEach(() => {
  process.env.PA_GOOGLE_ACCESS_TOKEN = 'ya29.test_token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.PA_GOOGLE_ACCESS_TOKEN;
});

describe('calendar tools', () => {
  it('reads are auto, create is gated', () => {
    expect(listUpcomingEventsTool.autonomy).toBe('auto');
    expect(createCalendarEventTool.autonomy).toBe('gated');
  });

  it('listUpcomingEvents GETs the primary calendar with singleEvents + orderBy and a Bearer token', async () => {
    const fetchFn = mockFetchSeq([
      { body: { items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-07-14T09:00:00Z' }, end: { dateTime: '2026-07-14T09:15:00Z' } }] } },
    ]);
    const res = await listUpcomingEventsTool.run({ maxResults: 5 }, CTX);
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
    expect(url).toContain('maxResults=5');
    expect((init as any)?.headers?.Authorization).toBe('Bearer ya29.test_token');
    expect((res.data as any[]).length).toBe(1);
  });

  it('createCalendarEvent POSTs an event with summary/start/end/attendees', async () => {
    const fetchFn = mockFetchSeq([{ body: { id: 'ev1', summary: 'Call', htmlLink: 'https://cal/ev1' } }]);
    const res = await createCalendarEventTool.run(
      { summary: 'Call', start: '2026-07-14T15:00:00Z', end: '2026-07-14T15:30:00Z', attendees: ['a@b.com'] },
      CTX,
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer ya29.test_token');
    const payload = JSON.parse((init as any).body);
    expect(payload.summary).toBe('Call');
    expect(payload.start).toEqual({ dateTime: '2026-07-14T15:00:00Z' });
    expect(payload.attendees).toEqual([{ email: 'a@b.com' }]);
  });

  it('createCalendarEvent uses the all-day {date} form for a bare YYYY-MM-DD', async () => {
    const fetchFn = mockFetchSeq([{ body: { id: 'ev2' } }]);
    await createCalendarEventTool.run({ summary: 'Holiday', start: '2026-08-01', end: '2026-08-02' }, CTX);
    const payload = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(payload.start).toEqual({ date: '2026-08-01' });
    expect(payload.end).toEqual({ date: '2026-08-02' });
  });

  it('missing token → not_configured (no throw), no fetch', async () => {
    delete process.env.PA_GOOGLE_ACCESS_TOKEN;
    const fetchFn = mockFetchSeq([{}]);
    const res = await createCalendarEventTool.run(
      { summary: 'x', start: '2026-07-14T15:00:00Z', end: '2026-07-14T15:30:00Z' },
      CTX,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('gmail tools', () => {
  it('read is auto, draft is gated', () => {
    expect(listRecentEmailTool.autonomy).toBe('auto');
    expect(draftEmailReplyTool.autonomy).toBe('gated');
  });

  it('listRecentEmail lists messages then fetches bounded metadata with a Bearer token', async () => {
    const fetchFn = mockFetchSeq([
      { body: { messages: [{ id: 'm1' }] } }, // list
      { body: { id: 'm1', threadId: 't1', snippet: 'hi', payload: { headers: [ { name: 'From', value: 'x@y.com' }, { name: 'Subject', value: 'Hello' } ] } } }, // metadata
    ]);
    const res = await listRecentEmailTool.run({ maxResults: 5 }, CTX);
    expect(res.ok).toBe(true);
    const [listUrl, listInit] = fetchFn.mock.calls[0];
    expect(listUrl).toContain('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    expect((listInit as any).headers.Authorization).toBe('Bearer ya29.test_token');
    const [metaUrl] = fetchFn.mock.calls[1];
    expect(metaUrl).toContain('/messages/m1?format=metadata');
    expect((res.data as any[])[0].subject).toBe('Hello');
  });

  it('draftEmailReply POSTs a base64url raw message to Gmail drafts (never sends)', async () => {
    const fetchFn = mockFetchSeq([{ body: { id: 'd1', message: { id: 'msg1', threadId: 't1' } } }]);
    const res = await draftEmailReplyTool.run(
      { to: 'a@b.com', subject: 'Re: hi', body: 'thanks', threadId: 't1' },
      CTX,
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts');
    expect((init as any).method).toBe('POST');
    const payload = JSON.parse((init as any).body);
    expect(payload.message.threadId).toBe('t1');
    // raw is base64url — decode and confirm the To header + body round-trip.
    const decoded = Buffer.from(payload.message.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(decoded).toContain('To: a@b.com');
    expect(decoded).toContain('thanks');
  });

  it('missing token → not_configured (no throw), no fetch', async () => {
    delete process.env.PA_GOOGLE_ACCESS_TOKEN;
    const fetchFn = mockFetchSeq([{}]);
    const res = await listRecentEmailTool.run({}, CTX);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
