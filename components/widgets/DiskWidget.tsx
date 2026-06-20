'use client';

import { useEffect, useState } from 'react';

// Per-mount disk usage from Prometheus (via the Clerk-gated /api/metrics/disk,
// which runs the PromQL server-side). Shows a labelled bar per mountpoint with
// the used %; bars turn amber/red as they fill. Themed with CSS vars; renders
// an "unreachable" state when Prometheus is down.

type Mount = { mount: string; usedPct: number };

function barColor(pct: number): string {
  if (pct >= 90) return 'var(--crit)';
  if (pct >= 75) return 'var(--high)';
  return 'var(--blue)';
}

export function DiskWidget() {
  const [mounts, setMounts] = useState<Mount[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'unreachable'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/disk', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok || d.live === false) { setState('unreachable'); return; }
          setMounts(Array.isArray(d.mounts) ? d.mounts : []);
          setState('ok');
        })
        .catch(() => { if (!cancelled) setState('unreachable'); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (state === 'loading') return <div className="mon-state">Loading disk…</div>;
  if (state === 'unreachable') return <div className="mon-state">Prometheus unreachable</div>;
  if (!mounts || mounts.length === 0) return <div className="mon-state">No filesystems reported</div>;

  return (
    <div className="mon-disk">
      {mounts.map((m) => (
        <div key={m.mount} className="mon-disk-row">
          <div className="mon-disk-head">
            <span className="mon-disk-mount" title={m.mount}>{m.mount}</span>
            <span className="mon-disk-pct">{m.usedPct.toFixed(0)}%</span>
          </div>
          <div className="mon-disk-track">
            <div
              className="mon-disk-fill"
              style={{ width: `${Math.max(2, Math.min(100, m.usedPct))}%`, background: barColor(m.usedPct) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
