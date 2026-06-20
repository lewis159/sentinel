// Active-alerts feed for the monitoring dashboard's AlertsWidget. Clerk-gated
// via requireOpsAuth(); reads Alertmanager's v2 API server-side. Returns the
// active alerts grouped by severity plus a compact list, or a clear unreachable
// state when Alertmanager is down.
//
//   GET /api/metrics/alerts → { ok, groups, alerts: [...], note? }

import { requireOpsAuth } from '@/lib/auth';
import { getActiveAlerts } from '@/lib/alertmanager';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ok, alerts, groups, note } = await getActiveAlerts();
  return Response.json({ ok, alerts, groups, note });
}
