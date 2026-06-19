import { APP_LABEL, type EstateApp } from '@/lib/mock';

// Colored pill identifying which estate app a ticket / roadmap card belongs to.
const APP_STYLE: Record<string, { bg: string; fg: string }> = {
  YT: { bg: 'rgba(229,72,77,.16)', fg: '#ff8b8e' },        // YT brand red
  Sentinel: { bg: 'rgba(45,108,255,.16)', fg: '#7fa8ff' }, // Sentinel blue
  Bruce: { bg: 'rgba(245,165,36,.16)', fg: '#ffc05a' },    // Springsteen amber
  Estate: { bg: 'rgba(51,184,122,.16)', fg: '#5fd49b' },   // Estate-wide green
};

export function AppTag({ app }: { app: string }) {
  const s = APP_STYLE[app] ?? { bg: '#222838', fg: 'var(--muted)' };
  const label = (APP_LABEL as Record<string, string>)[app] ?? app;
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg, fontSize: 11 }}>
      {label}
    </span>
  );
}
