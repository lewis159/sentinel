// Small LIVE/mock data-source pill, matching the pattern used on the Tickets and
// Findings pages. `live` true → data came from the real DB.
export function LiveBadge({ live, table, note }: { live: boolean; table: string; note?: string }) {
  return (
    <span
      className="pill"
      style={{
        background: live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)',
        color: live ? '#5fd49b' : '#aab3c4',
      }}
    >
      <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
      {live ? `LIVE · ${table}` : `mock${note ? ' · ' + note : ''}`}
    </span>
  );
}
