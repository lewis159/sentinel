// Small LIVE/mock data-source pill, matching the pattern used on the Tickets and
// Findings pages. `live` true → data came from the real DB.
export function LiveBadge({ live, table, note }: { live: boolean; table: string; note?: string }) {
  return (
    <span className={`pill live-badge${live ? '' : ' mock'}`}>
      <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
      {live ? `LIVE · ${table}` : `mock${note ? ' · ' + note : ''}`}
    </span>
  );
}
