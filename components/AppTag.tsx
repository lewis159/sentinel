import { APP_LABEL, type EstateApp } from '@/lib/mock';

// Colored pill identifying which estate app a ticket / roadmap card belongs to.
// Each app maps to a theme token whose hue matches its brand, so the pills stay
// recognisable AND legible on light/slate (the raw tints washed out on white).
const APP_STYLE: Record<string, { bg: string; fg: string }> = {
  YT:       { bg: 'color-mix(in srgb, var(--crit) 16%, transparent)',   fg: 'var(--crit)' },   // YT brand red
  Sentinel: { bg: 'color-mix(in srgb, var(--accent) 16%, transparent)', fg: 'var(--accent)' }, // Sentinel blue
  Bruce:    { bg: 'color-mix(in srgb, var(--high) 16%, transparent)',   fg: 'var(--high)' },   // Springsteen amber
  Estate:   { bg: 'color-mix(in srgb, var(--ok) 16%, transparent)',     fg: 'var(--ok)' },     // Estate-wide green
};

export function AppTag({ app }: { app: string }) {
  const s = APP_STYLE[app] ?? { bg: 'var(--panel-2)', fg: 'var(--muted)' };
  const label = (APP_LABEL as Record<string, string>)[app] ?? app;
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg, fontSize: 11 }}>
      {label}
    </span>
  );
}
