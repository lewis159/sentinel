'use client';

import { useEffect, useState } from 'react';

// Per-monitor up/down grid from Uptime Kuma (via the Clerk-gated
// /api/metrics/uptime, which reads Kuma's /metrics server-side). Shows an
// up/total summary + a grid of monitor chips. Clear "not configured /
// unreachable" state when no API key is set or Kuma is down.

type Monitor = { name: string; up: boolean; status: number };

export function UptimeWidget() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/uptime', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok) { setNote(d?.note); setState('down'); return; }
          setMonitors(Array.isArray(d.monitors) ? d.monitors : []);
          setState('ok');
        })
        .catch(() => { if (!cancelled) { setNote('unreachable'); setState('down'); } });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (state === 'loading') return <div className="mon-state">Loading uptime…</div>;
  if (state === 'down') return <div className="mon-state">Uptime Kuma {note ?? 'unreachable'}</div>;
  if (!monitors || monitors.length === 0) return <div className="mon-state">No monitors configured</div>;

  const up = monitors.filter((m) => m.up).length;
  const allUp = up === monitors.length;

  return (
    <div className="mon-uptime">
      <div className="mon-uptime-sum">
        <span className="mon-dot" style={{ background: allUp ? 'var(--ok)' : 'var(--high)' }} aria-hidden />
        <strong>{up}</strong>&nbsp;/&nbsp;{monitors.length} up
      </div>
      <div className="mon-uptime-grid">
        {monitors.map((m) => (
          <div key={m.name} className={`mon-uptime-chip${m.up ? ' up' : ' down'}`} title={m.up ? 'up' : 'down'}>
            <span className="mon-dot" style={{ background: m.up ? 'var(--ok)' : 'var(--high)' }} aria-hidden />
            <span className="mon-uptime-name">{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
