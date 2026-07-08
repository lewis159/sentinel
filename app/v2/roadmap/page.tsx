import './roadmap.css';
import { requireSectionPage } from '@/lib/auth';
import { getRoadmap } from '@/lib/data';
import type { RoadmapItem } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Roadmap. Renders inside the v2 shell (.v2-shell > .v2-content);
// this file supplies page content only. A kanban board grouping the live
// ops.roadmap_items (getRoadmap) by status into four columns. Falls back to
// mock roadmap items when the DB is unreachable/empty (handled by getRoadmap).

type Column = { status: string; label: string; tone: string };

// Column order + display labels. Keys match RoadmapItem.status
// (backlog|in_progress|in_review|shipped).
const COLUMNS: Column[] = [
  { status: 'backlog', label: 'Backlog', tone: 'info' },
  { status: 'in_progress', label: 'In progress', tone: 'sky' },
  { status: 'in_review', label: 'In review', tone: 'high' },
  { status: 'shipped', label: 'Shipped', tone: 'ok' },
];

// App tag → colour tone (mirrors the estate app palette).
function appTone(app: string): string {
  switch (app) {
    case 'Sentinel': return 'sentinel';
    case 'YT': return 'yt';
    case 'Bruce': return 'bruce';
    default: return 'estate';
  }
}

export default async function RoadmapPage() {
  await requireSectionPage('operations');

  const { rows, live } = await getRoadmap();

  // Group items by status; unknown statuses land in backlog so nothing is lost.
  const byStatus = new Map<string, RoadmapItem[]>();
  for (const c of COLUMNS) byStatus.set(c.status, []);
  for (const item of rows) {
    const bucket = byStatus.has(item.status) ? item.status : 'backlog';
    byStatus.get(bucket)!.push(item);
  }

  return (
    <div className="v2-rm">
      {/* Header */}
      <div className="v2-rm-head">
        <div>
          <div className="v2-eyebrow">Delivery</div>
          <h1 className="v2-h1">Roadmap</h1>
          <div className="v2-sub">
            What&apos;s planned, in flight, and shipped across the estate
          </div>
        </div>
        <span className={`v2-rm-live${live ? ' on' : ''}`}>
          <span className="dot" />
          {live ? 'Live' : 'Sample data'}
        </span>
      </div>

      {/* Kanban board */}
      <div className="v2-rm-board">
        {COLUMNS.map((col) => {
          const items = byStatus.get(col.status) ?? [];
          return (
            <div className="v2-card v2-rm-col" key={col.status}>
              <div className="v2-rm-col-h">
                <span className={`v2-rm-dot ${col.tone}`} />
                <h3>{col.label}</h3>
                <span className="v2-rm-count">{items.length}</span>
              </div>

              <div className="v2-rm-col-body">
                {items.length === 0 ? (
                  <div className="v2-rm-empty">Nothing here yet</div>
                ) : (
                  items.map((item) => (
                    <div className="v2-rm-card" key={item.itemKey}>
                      <div className="v2-rm-card-top">
                        <span className="v2-rm-key">{item.itemKey}</span>
                        <span className={`v2-rm-app ${appTone(item.app)}`}>{item.app}</span>
                      </div>
                      <div className="v2-rm-title">{item.title}</div>
                      {item.description ? (
                        <div className="v2-rm-desc">{item.description}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
