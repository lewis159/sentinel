// Recent-logs tail for the monitoring dashboard's LogTailWidget. Clerk-gated via
// requireOpsAuth(); reads Grafana Loki's query_range API server-side with a
// broad (tunable) LogQL selector. Returns the most recent ~25 lines (newest
// first) with a best-effort level, or a clear unreachable state when Loki is
// down.
//
//   GET /api/metrics/logs → { ok, query, lines: [{ts,level,line,stream?}], note? }

import { requireOpsAuth } from '@/lib/auth';
import { getRecentLogs } from '@/lib/loki';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ok, lines, query, note } = await getRecentLogs(25);
  return Response.json({ ok, lines, query, note });
}
