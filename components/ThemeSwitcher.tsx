'use client';

// Theme picker. Renders a swatch row; clicking a swatch:
//   1. sets document.documentElement.dataset.theme  (instant repaint)
//   2. writes localStorage (instant no-flash on next load)
//   3. PUTs { theme } to /api/layouts/theme  (per-user, DB-backed)
//
// On mount it reconciles the active theme with the DB value (GET) — the
// no-flash inline script in app/layout.tsx has already applied the cached
// theme before paint, so this only corrects drift between devices.

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_THEME,
  THEME_LAYOUT_KEY,
  THEME_META,
  THEME_STORAGE_KEY,
  THEMES,
  isTheme,
  type Theme,
} from '@/lib/theme';

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

function readActiveTheme(): Theme {
  if (typeof document !== 'undefined') {
    const t = document.documentElement.dataset.theme;
    if (isTheme(t)) return t;
  }
  return DEFAULT_THEME;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  // Sync state to whatever the no-flash script applied, then reconcile w/ DB.
  useEffect(() => {
    setTheme(readActiveTheme());

    let cancelled = false;
    fetch(`/api/layouts/${THEME_LAYOUT_KEY}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout?.theme;
        if (isTheme(saved) && saved !== readActiveTheme()) {
          applyTheme(saved);
          setTheme(saved);
          try { localStorage.setItem(THEME_STORAGE_KEY, saved); } catch {}
        }
      })
      .catch(() => { /* keep cached/default theme */ });

    return () => { cancelled = true; };
  }, []);

  const choose = useCallback((next: Theme) => {
    applyTheme(next);
    setTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
    fetch(`/api/layouts/${THEME_LAYOUT_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    }).catch(() => { /* localStorage already holds it */ });
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{ display: 'flex', gap: compact ? 6 : 8, flexWrap: 'wrap', alignItems: 'center' }}
    >
      {THEMES.map((t) => {
        const meta = THEME_META[t];
        const on = theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${meta.label} — ${meta.hint}`}
            onClick={() => choose(t)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: compact ? '5px 8px' : '6px 11px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: 'inherit',
              color: on ? 'var(--accent)' : 'var(--muted)',
              background: on ? 'var(--accent-bg)' : 'var(--panel)',
              border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border)'}`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                flexShrink: 0,
                background: meta.swatch,
                boxShadow: `inset 0 0 0 3px ${meta.accent}`,
                border: '1px solid var(--border)',
              }}
            />
            {!compact && meta.label}
          </button>
        );
      })}
    </div>
  );
}
