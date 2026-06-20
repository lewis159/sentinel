// Uptime status for the monitoring dashboard's UptimeWidget. Clerk-gated via
// requireOpsAuth(); reads Uptime Kuma's /metrics endpoint server-side (Basic
// auth with the API key). Returns the per-monitor up/down list, or a clear
// not-configured / unreachable state when the key is missing or Kuma is down.
//
//   GET /api/metrics/uptime → { ok, monitors: [{name,up,status}], note? }

import { requireOpsAuth } from '@/lib/auth';
import { getUptimeStatus } from '@/lib/uptime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { monitors, ok, note } = await getUptimeStatus();
  return Response.json({ ok, monitors, note });
}
