'use client';

import { useState } from 'react';
import {
  sevClass, sevLabel, KIND_LABEL, KIND_STATUSES,
  type ServiceTicket, type TicketKind,
} from '@/lib/mock';
import { AppTag } from './AppTag';
import { TicketDetail } from './TicketDetail';
import { KanbanBoard, type KanbanCard } from './KanbanBoard';
import { NewTicketButton } from './CreateTicketModal';

const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], draft: ['st-mute', 'Draft'], in_progress: ['st-prog', 'In progress'],
  investigating: ['st-prog', 'Investigating'], awaiting_cab: ['st-prog', 'Awaiting CAB'],
  building: ['st-prog', 'Building'], planned: ['st-blue', 'Planned'], scheduled: ['st-blue', 'Scheduled'],
  staged: ['st-blue', 'Staged'], approved: ['st-done', 'Approved'], implemented: ['st-done', 'Implemented'],
  deployed: ['st-done', 'Deployed'], verified: ['st-done', 'Verified'], fulfilled: ['st-done', 'Fulfilled'],
  resolved: ['st-done', 'Resolved'], known_error: ['st-open', 'Known error'], closed: ['st-mute', 'Closed'],
};

function label(status: string): string {
  return statusTag[status]?.[1] ?? status;
}

// The core section screen: List ⇄ Board toggle. Default = List (master-detail).
export function SectionView({ kind, tickets }: { kind: TicketKind; tickets: ServiceTicket[] }) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [selected, setSelected] = useState<string | null>(tickets[0]?.ref ?? null);
  const detail = tickets.find((t) => t.ref === selected) ?? tickets[0] ?? null;

  const columns = KIND_STATUSES[kind].map((s) => ({ key: s, label: label(s) }));
  const cards: KanbanCard[] = tickets.map((t) => ({
    id: t.ref, title: t.title, subtitle: t.description, app: t.app, priority: t.priority,
  }));

  return (
    <div>
      <div className="row spread mb">
        <div className="row" style={{ gap: 6 }}>
          <button className={`chip ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>List</button>
          <button className={`chip ${view === 'board' ? 'on' : ''}`} onClick={() => setView('board')}>Board</button>
        </div>
        <NewTicketButton kind={kind} />
      </div>

      {view === 'board' ? (
        <KanbanBoard columns={columns} cards={cards} groupBy={(c) => tickets.find((t) => t.ref === c.id)?.status ?? columns[0].key} />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '380px 1fr' }}>
          {/* Master list */}
          <div className="card pad0" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            {tickets.length === 0 && <div className="placeholder" style={{ margin: 16 }}><div className="big">∅</div>No {KIND_LABEL[kind].toLowerCase()}s yet.</div>}
            {tickets.map((t) => {
              const [cls, lab] = statusTag[t.status] ?? ['st-mute', t.status];
              const on = t.ref === selected;
              return (
                <button
                  key={t.ref}
                  className="sv-row"
                  data-on={on}
                  onClick={() => setSelected(t.ref)}
                >
                  <div className="row spread" style={{ marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 11 }}>{t.ref}</span>
                    <AppTag app={t.app} />
                  </div>
                  <div className="sv-title">{t.title}</div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <span className={`tag ${cls}`} style={{ fontSize: 10 }}>{lab}</span>
                    <span className={`pill ${sevClass[t.priority]}`} style={{ fontSize: 10 }}>● {sevLabel[t.priority]}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail pane */}
          <div>
            {detail ? <TicketDetail t={detail} /> : <div className="placeholder"><div className="big">←</div>Select a record.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
