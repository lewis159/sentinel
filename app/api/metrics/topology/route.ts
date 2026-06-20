// Swarm topology for the monitoring dashboard's TopologyWidget. Clerk-gated via
// requireOpsAuth(); reads services + tasks from the read-only docker-socket-proxy
// server-side and returns a stack→service→task tree. Falls back to a mock tree
// (live:false) when the proxy is unconfigured or a call fails.
//
//   GET /api/metrics/topology → { ok, live, stacks: [...] }

import { requireOpsAuth } from '@/lib/auth';
import { getTopology } from '@/lib/docker';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { stacks, live } = await getTopology();
  return Response.json({ ok: true, live, stacks });
}
