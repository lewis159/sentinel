// Theme system — shared constants for the four selectable palettes.
//
// Themes work by redefining the app's existing CSS custom properties under
// :root[data-theme="…"] in app/globals.css. This module only carries the
// list of theme ids and the persistence keys; the colours live in CSS.
//
// Persistence:
//   - localStorage[THEME_STORAGE_KEY]  → instant, no-flash on load
//   - PUT /api/layouts/theme  body { theme } → per-user, DB-backed
// The layout API stores arbitrary JSON objects per key, so we reuse it with
// key "theme" and a { theme } payload (no new endpoint).

export const THEMES = ['dark', 'light', 'midnight', 'slate'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';

export const THEME_STORAGE_KEY = 'sentinel.theme';
export const THEME_LAYOUT_KEY = 'theme';

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

// Label + small swatch metadata for the switcher UI.
export const THEME_META: Record<Theme, { label: string; hint: string; swatch: string; accent: string }> = {
  dark:     { label: 'Dark',     hint: 'Default console',   swatch: '#0E1217', accent: '#3F8AE0' },
  light:    { label: 'Light',    hint: 'Bright',            swatch: '#F4F6F8', accent: '#185FA5' },
  midnight: { label: 'Midnight', hint: 'Indigo dark',       swatch: '#0D1020', accent: '#8E86E6' },
  slate:    { label: 'Slate',    hint: 'Warm light',        swatch: '#ECEEED', accent: '#0F6E56' },
};
