import { sevClass, sevLabel, type ServiceTicket } from '@/lib/mock';
import { AppTag } from './AppTag';

// Release pipeline: stage columns Planned → Build → Staging → Deploy → Released
// of release tickets (kind=release), each card showing the app tag + version
// (attrs.version). Presentational (server component) — matches KanbanBoard look.
//
// Maps the release lifecycle statuses (planned|building|staged|deployed|verified)
// onto the five visible pipeline stages. Any unrecognised status falls into the
// first stage so nothing is silently dropped.
const STAGES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'planned',  label: 'Planned',  statuses: ['planned', 'draft'] },
  { key: 'build',    label: 'Build',    statuses: ['building'] },
  { key: 'staging',  label: 'Staging',  statuses: ['staged'] },
  { key: 'deploy',   label: 'Deploy',   statuses: ['deployed'] },
  { key: 'released', label: 'Released', statuses: ['verified', 'released', 'closed'] },
];

function stageFor(status: string): string {
  const hit = STAGES.find((s) => s.statuses.includes(status));
  return hit?.key ?? STAGES[0].key;
}

export function ReleasePipeline({ releases }: { releases: ServiceTicket[] }) {
  const byStage = new Map<string, ServiceTicket[]>();
  for (const s of STAGES) byStage.set(s.key, []);
  for (const r of releases) byStage.get(stageFor(r.status))!.push(r);

  return (
    <div className="kanban">
      {STAGES.map((stage) => {
        const items = byStage.get(stage.key) ?? [];
        return (
          <div key={stage.key} className="kanban-col">
            <div className="kanban-col-h">
              <span>{stage.label}</span>
              <span className="kanban-count">{items.length}</span>
            </div>
            <div className="kanban-cards">
              {items.length === 0 && <div className="kanban-empty">—</div>}
              {items.map((r) => {
                const version = r.attrs?.version ? String(r.attrs.version) : null;
                return (
                  <div key={r.ref} className="kanban-card" style={{ cursor: 'default' }}>
                    <div className="kanban-card-top">
                      <span className="mono" style={{ fontSize: 11 }}>{r.ref}</span>
                      <AppTag app={r.app} />
                    </div>
                    <div className="kanban-card-title">{r.title}</div>
                    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {version && <span className="tag st-blue" style={{ fontSize: 10.5 }}>{version}</span>}
                      <span className={`pill ${sevClass[r.priority]}`} style={{ fontSize: 10.5 }}>● {sevLabel[r.priority]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
