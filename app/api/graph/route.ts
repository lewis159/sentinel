// Global graph API — returns the whole findings↔ticket↔KB↔infra graph as
// nodes + edges from ops.links, enriched with finding/ticket/component metadata
// and LIVE container state overlaid on container nodes. Gated by requireOpsAuth().
// Consumed by the Cytoscape graph on /graph (loaded via dynamic(ssr:false)).
//
//   GET /api/graph → { ok, live, nodes: GraphNode[], edges: GraphEdge[] }
//
// Degrades gracefully: no DB / migration not applied → { live:false, nodes:[], edges:[] }.

import { requireOpsAuth } from '@/lib/auth';
import { getGraph } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  try {
    const { nodes, edges, live } = await getGraph();
    return Response.json({ ok: true, live, nodes, edges });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'graph failed' }, { status: 500 });
  }
}
