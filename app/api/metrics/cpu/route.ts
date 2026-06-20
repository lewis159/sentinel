// CPU metrics for the monitoring dashboard's CpuWidget. Clerk-gated via
// requireOpsAuth(); the PromQL runs server-side against Prometheus. Returns an
// instant cluster CPU% value plus a short range series for a sparkline. When
// Prometheus is unreachable, `live` is false and the widget shows an
// "unreachable" state.
//
//   GET /api/metrics/cpu → { ok, live, current, points: [{ts,value}], note? }

import { requireOpsAuth } from '@/lib/auth';
import { promQuery, promRange } from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

// Cluster CPU utilisation %: 100 - idle%, averaged across all node CPUs.
// Uses node-exporter's cpu seconds counter (mode="idle").
const CPU_EXPR =
  '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))';

// Fallback: cAdvisor container CPU as a fraction of one core, summed → cluster
// busy cores expressed as a percentage of available cores. Used only if the
// node-exporter expression returns nothing (e.g. no node-exporter).
const CPU_FALLBACK_EXPR =
  '100 * sum(rate(container_cpu_usage_seconds_total{image!=""}[2m])) / count(count(node_cpu_seconds_total) by (cpu))';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  let instant = await promQuery(CPU_EXPR);
  let range = await promRange(CPU_EXPR, 1, 30);

  // If the primary expression is empty (not an error — Prometheus reachable but
  // no series), try the cAdvisor fallback before declaring no data.
  if (instant !== null && instant.length === 0) {
    const fb = await promQuery(CPU_FALLBACK_EXPR);
    if (fb && fb.length > 0) {
      instant = fb;
      range = await promRange(CPU_FALLBACK_EXPR, 1, 30);
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
