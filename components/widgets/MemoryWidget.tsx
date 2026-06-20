'use client';

import { useEffect, useState } from 'react';

// Memory% from Prometheus (via the Clerk-gated /api/metrics/memory, which runs
// the PromQL server-side). Shows the current cluster memory-used % as a big
// value plus a small area sparkline of the last ~30 minutes. Mirrors CpuWidget.
// Themed with CSS vars; renders an "unreachable" state when Prometheus is down.

type Point = { ts: number; value: number };

// Build an SVG area + line path from points scaled into a viewBox. y is
// inverted (0% at the bottom). Width/height are viewBox units; CSS scales it.
function buildPaths(points: Point[], w: number, h: number): { area: string; line: string } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const xs = (i: number) => (i / (n - 1)) * w;
  const ys = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h;
  let line = '';
  points.forEach((p, i) => {
    line += `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(2)},${ys(p.value).toFixed(2)} `;
  });
  const area = `M0,${h} ` + points.map((p, i) => `L${xs(i).toFixed(2)},${ys(p.value).toFixed(2)}`).join(' ') + ` L${w},${h} Z`;
  return { area, line: line.trim() };
}

export function MemoryWidget() {
  const [current, setCurrent] = useState<number | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'unreachable'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/memory', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok || d.live === false) { setState('unreachable'); return; }
          setCurrent(typeof d.current === 'number' ? d.current : null);
          setPoints(Array.isArray(d.points) ? d.points : []);
          setState('ok');
        })
        .catch(() => { if (!cancelled) setState('unreachable'); });
    };
    load();
    const id = setInterval(load, 30000); // refresh every 30s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (state === 'loading') return <div className="mon-state">Loading memory…</div>;
  if (state === 'unreachable') return <div className="mon-state">Prometheus unreachable</div>;

  const W = 200, H = 60;
  const paths = buildPaths(points, W, H);

  return (
    <div className="mon-cpu">
      <div className="mon-metric">
        <div className="mon-metric-v">{current !== null ? `${current.toFixed(0)}%` : '—'}</div>
        <div className="mon-metric-l">cluster memory</div>
      </div>
      {paths ? (
        <svg className="mon-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path d={paths.area} fill="var(--accent-bg, rgba(45,108,255,.18))" />
          <path d={paths.line} fill="none" stroke="var(--blue, #2D6CFF)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="mon-note">no history yet</div>
      )}
    </div>
  );
}
