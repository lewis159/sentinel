import { getRoadmap } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { KanbanBoard, type KanbanCard } from '@/components/KanbanBoard';
import { LiveBadge } from '@/components/LiveBadge';
import { ROADMAP_STATUSES, ROADMAP_STATUS_LABEL } from '@/lib/mock';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

export default async function RoadmapPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getRoadmap();

  const columns = ROADMAP_STATUSES.map((s) => ({ key: s, label: ROADMAP_STATUS_LABEL[s] ?? s }));
  const cards: KanbanCard[] = rows.map((r) => ({
    id: r.itemKey, title: r.title, subtitle: r.description, app: r.app,
  }));
  const byKey = new Map(rows.map((r) => [r.itemKey, r.status]));

  return (
    <div>
      <AutoRefresh source="roadmap" />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Roadmap</div>
            <LiveBadge live={live} table="ops.roadmap_items" note={note} />
          </div>
          <div className="sub">Current release cycle · feeds the changelog on ship · agent-writable</div>
        </div>
        <button className="btn sm">+ Add item</button>
      </div>

      <KanbanBoard columns={columns} cards={cards} groupBy={(c) => byKey.get(c.id) ?? ROADMAP_STATUSES[0]} />
    </div>
  );
}
