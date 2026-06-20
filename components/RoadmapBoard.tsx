'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KanbanBoard, type KanbanCard, type KanbanColumn } from './KanbanBoard';
import {
  ROADMAP_STATUSES, ROADMAP_STATUS_LABEL, APP_LABEL,
  type EstateApp, type RoadmapItem,
} from '@/lib/mock';

const APPS: EstateApp[] = ['YT', 'Sentinel', 'Bruce', 'Estate'];

// Client wrapper around the read-only KanbanBoard. Keeps the server page's data
// fetch + grouping intact (cards/columns/groupBy are passed in) but makes each
// card open an editable modal, and owns the "+ New item" button. Saves go to the
// Clerk-gated /api/roadmap CRUD routes; on success we router.refresh() so the
// server-rendered board reflects the change.
export function RoadmapBoard({
  columns, cards, statusByKey, items,
}: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  // Map card id → status column key (computed server-side from live rows).
  statusByKey: Record<string, string>;
  // Full row data keyed by item_key, so the modal can prefill every field.
  items: Record<string, RoadmapItem>;
}) {
  // null = closed; 'new' = create mode; a key = edit that item.
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const open = editing !== null;
  const editItem = editing && editing !== 'new' ? items[editing] : undefined;

  return (
    <>
      <div className="spread mb">
        <div />
        <button className="btn sm" onClick={() => setEditing('new')}>+ Add item</button>
      </div>

      <KanbanBoard
        columns={columns}
        cards={cards}
        groupBy={(c) => statusByKey[c.id] ?? ROADMAP_STATUSES[0]}
        onCardClick={(id) => setEditing(id)}
      />

      {open && (
        <RoadmapModal
          item={editItem}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RoadmapModal({
  item, onClose,
}: { item?: RoadmapItem; onClose: () => void }) {
  const router = useRouter();
  const isEdit = Boolean(item);

  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [status, setStatus] = useState<string>(item?.status ?? ROADMAP_STATUSES[0]);
  const [app, setApp] = useState<string>(item?.app ?? 'Estate');
  const [sortOrder, setSortOrder] = useState<string>(String(item?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr(null);

    const payload = {
      title: title.trim(),
      description,
      status,
      app,
      sort_order: Number.parseInt(sortOrder, 10) || 0,
    };

    try {
      const res = isEdit
        ? await fetch(`/api/roadmap/${encodeURIComponent(item!.itemKey)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/roadmap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      onClose();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    if (!window.confirm(`Delete roadmap item ${item.itemKey}? This can't be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/roadmap/${encodeURIComponent(item.itemKey)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? `Failed (${res.status})`); setBusy(false); return; }
      onClose();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Network error'); setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h3>{isEdit ? `Edit ${item!.itemKey}` : 'New roadmap item'}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {err && <div className="form-err">{err}</div>}
            <div className="field">
              <label>Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary of the roadmap item" autoFocus />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea className="textarea" value={description}
                onChange={(e) => setDescription(e.target.value)} placeholder="What this delivers" />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Status</label>
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {ROADMAP_STATUSES.map((s) => (
                    <option key={s} value={s}>{ROADMAP_STATUS_LABEL[s] ?? s}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>App</label>
                <select className="select" value={app} onChange={(e) => setApp(e.target.value)}>
                  {APPS.map((a) => <option key={a} value={a}>{APP_LABEL[a]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Sort order</label>
                <input className="input" type="number" value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-foot">
            {isEdit && (
              <button type="button" className="btn ghost sm" onClick={remove} disabled={busy}
                style={{ marginRight: 'auto', color: 'var(--crit)' }}>Delete</button>
            )}
            <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn sm" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
