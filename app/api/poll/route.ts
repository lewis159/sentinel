// Cheap change-detection endpoint for silent auto-refresh.
//
//   GET /api/poll?source=incident  → { ok, sig: "<count>:<latest-iso-or-0>" }
//
// Each data page mounts <AutoRefresh source="..." />, which polls this on a
// ~20s cadence (only while the tab is visible) and calls router.refresh() when
// the signature changes. The signature is a count + latest timestamp for the
// page's backing table — minimal queries, no row payloads.
//
// Gated by requireOpsAuth() like every other Sentinel API route (the
// AutoRefresh fetch carries the operator's Clerk session). When the DB is
// unavailable or a query errors we return a STABLE constant sig ("mock") so the
// poller never sees a change and never triggers a refresh loop.

import { requireOpsAuth } from '@/lib/auth';
import { hasDb, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STABLE = 'mock';

// Map a source key to the cheap (count, latest-timestamp) query that defines
// its signature. ticket kinds share ops.tickets, filtered by kind.
type SigQuery = { text: string; params?: any[] };

const TICKET_KINDS = new Set(['incident', 'request', 'change', 'problem', 'release']);

function queryFor(source: string): SigQuery | null {
  if (TICKET_KINDS.has(source)) {
    return {
      text: 'select count(*)::int c, max(updated_at) m from ops.tickets where kind=$1',
      params: [source],
    };
  }
  switch (source) {
    case 'roadmap':
      return { text: 'select count(*)::int c, max(updated_at) m from ops.roadmap_items' };
    case 'changelog':
      // changelog_entries has no updated_at column — use created_at.
      return { text: 'select count(*)::int c, max(created_at) m from ops.changelog_entries' };
    case 'alerts':
      return { text: 'select count(*)::int c, max(fired_at) m from ops.alerts' };
    case 'activity':
      // The activity feed is driven by background job runs (ops.jobs, the same
      // source as getScanRuns). Refresh when a job is created/updated.
      return { text: 'select count(*)::int c, max(updated_at) m from ops.jobs' };
    case 'users':
      // DB access table only — never poll Clerk (rate limits).
      return { text: 'select count(*)::int c, max(updated_at) m from ops.user_app_access' };
    default:
      return null;
  }
}

function toIso(v: unknown): string {
  if (!v) return '0';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function GET(req: Request) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const source = new URL(req.url).searchParams.get('source') ?? '';
  const sq = queryFor(source);
  if (!sq) {
    return Response.json({ ok: false, error: 'unknown source' }, { status: 400 });
  }

  if (!hasDb) return Response.json({ ok: true, sig: STABLE });

  try {
    const row = await q1<{ c: number; m: unknown }>(sq.text, sq.params);
    const count = Number(row?.c) || 0;
    const latest = toIso(row?.m);
    return Response.json({ ok: true, sig: `${count}:${latest}` });
  } catch {
    // Stable sig on error → no refresh loop.
    return Response.json({ ok: true, sig: STABLE });
  }
}
