import Link from 'next/link';
import { AppTag } from './AppTag';
import { sevClass, sevLabel, type Severity } from '@/lib/mock';

// Generic Kanban card model. `href` makes a card clickable; `priority`/`app`
// render the standard pills. Foundation pass: presentational columns grouped by
// status (drag-drop reordering is a later pass — see report).
export type KanbanCard = {
  id: string;
  title: string;
  subtitle?: string;
  app?: string;
  priority?: Severity;
  href?: string;
};

export type KanbanColumn = { key: string; label: string };

export function KanbanBoard({
  columns,
  cards,
  groupBy,
}: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  // Map a card to its column key. Defaults to identity on a `status` field
  // supplied by the caller via the card list ordering.
  groupBy: (card: KanbanCard) => string;
}) {
  const byCol = new Map<string, KanbanCard[]>();
  for (const c of columns) byCol.set(c.key, []);
  for (const card of cards) {
    const k = groupBy(card);
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k)!.push(card);
  }

  return (
    <div className="kanban">
      {columns.map((col) => {
        const items = byCol.get(col.key) ?? [];
        return (
          <div key={col.key} className="kanban-col">
            <div className="kanban-col-h">
              <span>{col.label}</span>
              <span className="kanban-count">{items.length}</span>
            </div>
            <div className="kanban-cards">
              {items.length === 0 && <div className="kanban-empty">—</div>}
              {items.map((card) => {
                const inner = (
                  <>
                    <div className="kanban-card-top">
                      <span className="mono" style={{ fontSize: 11 }}>{card.id}</span>
                      {card.app && <AppTag app={card.app} />}
                    </div>
                    <div className="kanban-card-title">{card.title}</div>
                    {card.subtitle && <div className="sub" style={{ fontSize: 11.5 }}>{card.subtitle}</div>}
                    {card.priority && (
                      <span className={`pill ${sevClass[card.priority]}`} style={{ marginTop: 8, fontSize: 10.5 }}>
                        ● {sevLabel[card.priority]}
                      </span>
                    )}
                  </>
                );
                return card.href ? (
                  <Link key={card.id} href={card.href} className="kanban-card">{inner}</Link>
                ) : (
                  <div key={card.id} className="kanban-card">{inner}</div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
