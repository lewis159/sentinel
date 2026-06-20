// Memory metrics for the monitoring dashboard's MemoryWidget. Clerk-gated via
// requireOpsAuth(); the PromQL runs server-side against Prometheus. Returns an
// instant cluster memory-used % value plus a short range series for a
// sparkline. When Prometheus is unreachable, `live` is false and the widget
// shows an "unreachable" state.
//
//   GET /api/metrics/memory → { ok, live, current, points: [{ts,value}], note? }

import { requireOpsAuth } from '@/lib/auth';
import { promQuery, promRange } from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

// Cluster memory used %: (total - available) / total, averaged across nodes.
// Uses node-exporter's MemAvailable/MemTotal gauges.
const MEM_EXPR =
  '100 * (1 - avg(node_memory_MemAvailable_bytes) / avg(node_memory_MemTotal_bytes))';

// Fallback: cAdvisor container working-set memory as a fraction of machine
// memory. Used only if the node-exporter expression returns nothing (e.g. no
// node-exporter deployed).
const MEM_FALLBACK_EXPR =
  '100 * sum(container_memory_working_set_bytes{image!=""}) / sum(machine_memory_bytes)';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  let instant = await promQuery(MEM_EXPR);
  let range = await promRange(MEM_EXPR, 1, 30);

  // Reachable but no series → try the cAdvisor fallback before declaring no data.
  if (instant !== null && instant.length === 0) {
    const fb = await promQuery(MEM_FALLBACK_EXPR);
    if (fb && fb.length > 0) {
      instant = fb;
      range = await promRange(MEM_FALLBACK_EXPR, 1, 30);
    }
  }

  if (instant === null) {
    return Response.json({ ok: true, live: false, current: null, points: [], note: 'prometheus unreachable' });
  }

  const current = instant.length > 0 ? Math.max(0, Math.min(100, instant[0].value)) : null;
  const series = range && range.length > 0 ? range[0].points : [];
  const points = series.map((p) => ({ ts: p.ts, value: Math.max(0, Math.min(100, p.value)) }));

  return Response.json({ ok: true, live: true, current, points });
}
