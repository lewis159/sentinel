'use client';

import { useEffect, useState } from 'react';

// Stack → service → running-task tree from the docker-socket-proxy (via the
// Clerk-gated /api/metrics/topology). Compact, collapsible per stack; shows
// replica counts (running / desired) and per-task state. Themed with CSS vars.

type TopoTask = { id: string; slot: number | null; state: string; desiredState: string; node: string };
type TopoService = {
  id: string; name: string; mode: string; desired: number | null; running: number; tasks: TopoTask[];
};
type TopoStack = { stack: string; services: TopoService[] };

const taskStateColor: Record<string, string> = {
  running: 'var(--ok)', starting: 'var(--high)', pending: 'var(--high)',
  failed: 'var(--crit, var(--high))', shutdown: 'var(--muted)', complete: 'var(--muted)', rejected: 'var(--crit, var(--high))',
};

export function TopologyWidget() {
  const [stacks, setStacks] = useState<TopoStack[] | null>(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/metrics/topology', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d?.ok || !Array.isArray(d.stacks)) { setErr(true); return; }
        setStacks(d.stacks);
        setLive(Boolean(d.live));
        // Default: expand all stacks.
        const o: Record<string, boolean> = {};
        for (const s of d.stacks) o[s.stack] = true;
        setOpen(o);
      })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, []);

  if (err) return <div className="mon-state">Topology source unreachable</div>;
  if (stacks === null) return <div className="mon-state">Loading topology…</div>;
  if (stacks.length === 0) return <div className="mon-state">No services found</div>;

  return (
    <div className="mon-topo">
      {!live && <div className="mon-note">mock — socket-proxy services not reachable</div>}
      {stacks.map((s) => {
        const expanded = open[s.stack] ?? true;
        const svcCount = s.services.length;
        return (
          <div key={s.stack} className="mon-topo-stack">
            <button
              className="mon-topo-stack-h"
              onClick={() => setOpen((o) => ({ ...o, [s.stack]: !expanded }))}
              aria-expanded={expanded}
            >
              <span className="mon-topo-caret" aria-hidden>{expanded ? '▾' : '▸'}</span>
              <span className="mono">{s.stack}</span>
              <span className="mon-topo-count">{svcCount} svc</span>
            </button>
            {expanded && s.services.map((svc) => {
              const ok = svc.desired === null ? svc.running > 0 : svc.running >= svc.desired;
              return (
                <div key={svc.id} className="mon-topo-svc">
                  <span
                    className="mon-dot"
                    style={{ background: ok ? 'var(--ok)' : 'var(--high)' }}
                    aria-hidden
                  />
                  <span className="mono mon-topo-svc-name">{svc.name}</span>
                  <span className="mon-topo-replicas">
                    {svc.running}{svc.desired !== null ? `/${svc.desired}` : ''}
                    {svc.mode === 'global' ? ' (global)' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
