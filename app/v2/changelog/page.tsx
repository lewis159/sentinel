import './changelog.css';
import { requireSectionPage } from '@/lib/auth';
import { getChangelog } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Changelog. Renders inside the v2 shell (.v2-shell > .v2-content);
// this file supplies page content only. A vertical timeline of live
// ops.changelog_entries (getChangelog), newest first. Falls back to mock
// entries when the DB is unreachable/empty (handled by getChangelog).

// App tag → colour tone (mirrors the estate app palette).
function appTone(app: string): string {
  switch (app) {
    case 'Sentinel': return 'sentinel';
    case 'YT': return 'yt';
    case 'Bruce': return 'bruce';
    default: return 'estate';
  }
}

// Deterministic, locale-independent date label (e.g. "8 Jul 2026"). getChangelog
// returns ISO strings; bad/empty dates fall back to a dash.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default async function ChangelogPage() {
  await requireSectionPage('operations');

  const { rows, live } = await getChangelog();
  // getChangelog already orders by date desc; guard anyway so newest is first.
  const entries = [...rows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="v2-cl">
      {/* Header */}
      <div className="v2-cl-head">
        <div>
          <div className="v2-eyebrow">Delivery</div>
          <h1 className="v2-h1">Changelog</h1>
          <div className="v2-sub">Released changes across the estate, newest first</div>
        </div>
        <span className={`v2-cl-live${live ? ' on' : ''}`}>
          <span className="dot" />
          {live ? 'Live' : 'Sample data'}
        </span>
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <div className="v2-card v2-cl-empty">No changelog entries yet</div>
      ) : (
        <div className="v2-cl-timeline">
          {entries.map((e, i) => (
            <div className="v2-cl-item" key={`${e.version || e.label}-${i}`}>
              <div className="v2-cl-rail">
                <span className="v2-cl-node" />
              </div>

              <div className="v2-card v2-cl-card">
                <div className="v2-cl-card-h">
                  {e.version ? <span className="v2-cl-ver">{e.version}</span> : null}
                  <span className="v2-cl-label">{e.label}</span>
                  <span className={`v2-cl-app ${appTone(e.app)}`}>{e.app}</span>
                  <span className="v2-cl-date">{fmtDate(e.date)}</span>
                </div>
                {e.body ? <div className="v2-cl-body">{e.body}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
