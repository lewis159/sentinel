'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import './newticket.css';

type Kind = 'incident' | 'request' | 'change' | 'problem' | 'release';
type Level = 'high' | 'medium' | 'low';

const KINDS: Kind[] = ['incident', 'request', 'change', 'problem', 'release'];
const APPS = ['YT', 'Sentinel', 'Bruce', 'Estate'];
const LEVELS: Level[] = ['high', 'medium', 'low'];

function NewTicketModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('request');
  const [app, setApp] = useState(APPS[0]);
  const [impact, setImpact] = useState<Level>('medium');
  const [urgency, setUrgency] = useState<Level>('medium');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim() || undefined,
          app,
          impact,
          urgency,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ref) {
        setError((data && (data.error as string)) || `Create failed (${res.status}).`);
        setSubmitting(false);
        return;
      }

      onClose();
      router.push('/v2/support/' + data.ref);
    } catch {
      setError('Network error — could not create ticket.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="v2-nt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="v2-nt-modal" onSubmit={handleSubmit}>
        <div className="v2-nt-head">
          <div className="v2-nt-title">New ticket</div>
          <button
            type="button"
            className="v2-nt-x"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="v2-nt-body">
          <div className="v2-nt-field">
            <label className="v2-nt-label" htmlFor="v2-nt-title-input">Title</label>
            <input
              id="v2-nt-title-input"
              className="v2-nt-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary"
              autoFocus
            />
          </div>

          <div className="v2-nt-row">
            <div className="v2-nt-field">
              <label className="v2-nt-label" htmlFor="v2-nt-kind">Kind</label>
              <select
                id="v2-nt-kind"
                className="v2-nt-select"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>

            <div className="v2-nt-field">
              <label className="v2-nt-label" htmlFor="v2-nt-app">App</label>
              <select
                id="v2-nt-app"
                className="v2-nt-select"
                value={app}
                onChange={(e) => setApp(e.target.value)}
              >
                {APPS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="v2-nt-row">
            <div className="v2-nt-field">
              <label className="v2-nt-label" htmlFor="v2-nt-impact">Impact</label>
              <select
                id="v2-nt-impact"
                className="v2-nt-select"
                value={impact}
                onChange={(e) => setImpact(e.target.value as Level)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            <div className="v2-nt-field">
              <label className="v2-nt-label" htmlFor="v2-nt-urgency">Urgency</label>
              <select
                id="v2-nt-urgency"
                className="v2-nt-select"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as Level)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="v2-nt-field">
            <label className="v2-nt-label" htmlFor="v2-nt-desc">Description</label>
            <textarea
              id="v2-nt-desc"
              className="v2-nt-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened, steps, context…"
            />
          </div>

          {error && <div className="v2-nt-err">{error}</div>}
        </div>

        <div className="v2-nt-foot">
          <button
            type="button"
            className="v2-btn ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="v2-btn" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewTicketButton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className ?? 'v2-btn'}
        onClick={() => setOpen(true)}
      >
        {label ?? 'New ticket'}
      </button>
      {open && <NewTicketModal onClose={() => setOpen(false)} />}
    </>
  );
}

export default NewTicketButton;
