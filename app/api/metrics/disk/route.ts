// Disk metrics for the monitoring dashboard's DiskWidget. Clerk-gated via
// requireOpsAuth(); the PromQL runs server-side against Prometheus. Returns a
// per-mountpoint used % list from node-exporter's filesystem gauges, excluding
// pseudo/ephemeral filesystems (tmpfs/overlay/etc.). When Prometheus is
// unreachable, `live` is false and the widget shows an "unreachable" state.
//
//   GET /api/metrics/disk → { ok, live, mounts: [{mount,usedPct}], note? }

import { requireOpsAuth } from '@/lib/auth';
import { promQuery } from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

// Per-filesystem used %: (size - avail) / size, excluding pseudo filesystems.
// node-exporter labels each series with `mountpoint` + `fstype`.
const DISK_EXPR =
  '100 * (1 - (' +
  'node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs|devtmpfs|aufs|fuse.*"} / ' +
  'node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs|devtmpfs|aufs|fuse.*"}' +
  '))';

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const instant = await promQuery(DISK_EXPR);

  if (instant === null) {
    return Response.json({ ok: true, live: false, mounts: [], note: 'prometheus unreachable' });
  }

  // One entry per mountpoint; de-dup (a mount can appear per-instance) keeping
  // the worst (highest used %) so the widget surfaces the tightest filesystem.
  const byMount = new Map<string, number>();
  for (const s of instant) {
    const mount = s.metric.mountpoint || s.metric.device || '/';
    const pct = Math.max(0, Math.min(100, s.value));
    const prev = byMount.get(mount);
    if (prev === undefined || pct > prev) byMount.set(mount, pct);
  }

  const mounts = [...byMount.entries()]
    .map(([mount, usedPct]) => ({ mount, usedPct }))
    .sort((a, b) => b.usedPct - a.usedPct);

  return Response.json({ ok: true, live: true, mounts });
}
