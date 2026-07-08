'use client';

import { useEffect, useRef, useState } from 'react';
import { REFRESH_OPTIONS, useRefresh } from '@/components/v2/RefreshProvider';

export default function RefreshControl() {
  const { intervalMs, setIntervalMs, paused, setPaused, effectiveMs } = useRefresh();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const live = effectiveMs > 0;
  const current = REFRESH_OPTIONS.find((o) => o.ms === intervalMs);
  const label = paused ? 'Paused' : current ? current.label : `${Math.round(intervalMs / 1000)}s`;

  return (
    <div className="v2-rc" ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="v2-rc-chip"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Live refresh interval"
      >
        <span className={`v2-rc-dot${live ? ' live' : ''}`} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {open && (
        <div className="v2-rc-menu" role="menu">
          {REFRESH_OPTIONS.map((o) => (
            <button
              key={o.ms}
              type="button"
              role="menuitem"
              className={`v2-rc-item${!paused && o.ms === intervalMs ? ' on' : ''}`}
              onClick={() => {
                setIntervalMs(o.ms);
                setPaused(false);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
          <div className="v2-rc-sep" />
          <button
            type="button"
            role="menuitem"
            className="v2-rc-item"
            onClick={() => {
              setPaused(!paused);
              setOpen(false);
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      )}
    </div>
  );
}
