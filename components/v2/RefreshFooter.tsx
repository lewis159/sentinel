'use client';

import { useEffect, useState } from 'react';
import { REFRESH_OPTIONS, useRefresh } from '@/components/v2/RefreshProvider';

export default function RefreshFooter() {
  const { intervalMs, setIntervalMs, paused, setPaused, effectiveMs, lastRefreshed } = useRefresh();
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick every second so the "updated Ns ago" label stays live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = effectiveMs > 0;
  const current = REFRESH_OPTIONS.find((o) => o.ms === intervalMs);
  const optLabel = current ? current.label : `${Math.round(intervalMs / 1000)}s`;

  let statusText: string;
  if (paused) statusText = 'Auto-refresh paused';
  else if (intervalMs === 0) statusText = 'Auto-refresh off';
  else statusText = `Live — updating every ${optLabel}`;

  let agoText: string;
  if (lastRefreshed == null) {
    agoText = '—';
  } else {
    const secs = Math.max(0, Math.floor((now - lastRefreshed) / 1000));
    agoText = secs < 2 ? 'just now' : `updated ${secs}s ago`;
  }

  return (
    <footer className="v2-footer">
      <div className="v2-footer-l">
        <span className={`v2-rc-dot${live ? ' live' : ''}`} aria-hidden="true" />
        <span>{statusText}</span>
      </div>

      <div className="v2-footer-r">
        <span className="v2-footer-ago">{agoText}</span>
        <select
          className="v2-footer-sel"
          value={String(intervalMs)}
          onChange={(e) => {
            setIntervalMs(Number(e.target.value));
            setPaused(false);
          }}
          aria-label="Refresh interval"
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.ms} value={String(o.ms)}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="v2-footer-btn"
          onClick={() => setPaused(!paused)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
    </footer>
  );
}
