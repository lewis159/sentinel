'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KIND_LABEL, KIND_STATUSES, APP_LABEL,
  type TicketKind, type EstateApp,
} from '@/lib/mock';

const APPS: EstateApp[] = ['YT', 'Sentinel', 'Bruce', 'Estate'];
const LEVELS = ['high', 'medium', 'low'] as const;

// Per-kind extra attrs collected at create time (mirrors TicketDetail's
// KindAttrs read-side). Kept minimal — the rest can be filled in on the record.
function kindAttrFields(kind: TicketKind): { key: string; label: string }[] {
  switch (kind) {
    case 'change': return [
      { key: 'change_type', label: 'Change type (normal / standard / emergency)' },
      { key: 'risk', label: 'Risk (high / medium / low)' },
      { key: 'window', label: 'Window' },
    ];
    case 'problem': return [{ key: 'root_cause', label: 'Root cause (if known)' }];
    case 'release': return [{ key: 'version', label: 'Version' }, { key: 'window', label: 'Window' }];
    default: return [];
  }
}

// Client create-modal: POSTs to /api/tickets then refreshes the server data.
export function CreateTicketModal({
  kind, label, onClose,
}: { kind: TicketKind; label: string; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [app, setApp] = useState<EstateApp>('Estate');
  const [impact, setImpact] = useState<string>('medium');
  const [urgency, setUrgency] = useState<string>('medium');
  const [status, setStatus] = useState<string>(KIND_STATUSES[kind][0]);
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const extra = kindAttrFields(kind);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, title: title.trim(), description, app, impact, urgency, status,
          attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v?.trim())),
        }),
      });
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
          <h3>New {label}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {err && <div className="form-err">{err}</div>}
            <div className="field">
              <label>Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={`Short summary of the ${label.toLowerCase()}`} autoFocus />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea className="textarea" value={description}
                onChange={(e) => setDescription(e.target.value)} placeholder="What happened / what's needed" />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>App</label>
                <select className="select" value={app} onChange={(e) => setApp(e.target.value as EstateApp)}>
                  {APPS.map((a) => <option key={a} value={a}>{APP_LABEL[a]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Status</label>
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {KIND_STATUSES[kind].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Impact</label>
                <select className="select" value={impact} onChange={(e) => setImpact(e.target.value)}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Urgency</label>
                <select className="select" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            {extra.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}</label>
                <input className="input" value={attrs[f.key] ?? ''}
                  onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn sm" disabled={busy}>{busy ? 'Creating…' : `Create ${label}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A standalone "+ New <kind>" button that owns the modal. Drop into any section.
export function NewTicketButton({ kind }: { kind: TicketKind }) {
  const [open, setOpen] = useState(false);
  const label = KIND_LABEL[kind] ?? kind;
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>+ New {label.toLowerCase()}</button>
      {open && <CreateTicketModal kind={kind} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}
