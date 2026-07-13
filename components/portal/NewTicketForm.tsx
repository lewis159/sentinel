'use client';

// New support request form — posts to /api/portal/tickets. Ownership (tenant) is
// set server-side from the session; this form only carries subject + body. On
// success it navigates to the created ticket.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const NO_DB = "Couldn't submit — this environment has no database.";

export function NewTicketForm() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const s = subject.trim();
    if (!s || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: s, body: body.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(res.status >= 500 ? NO_DB : data?.error || `Submit failed (${res.status}).`);
        setSubmitting(false);
        return;
      }
      // Land on the new ticket.
      router.push(`/portal/tickets/${encodeURIComponent(data.ref)}`);
      router.refresh();
    } catch {
      setError('Network error — could not submit your request.');
      setSubmitting(false);
    }
  }

  return (
    <div className="p-form">
      <label className="p-label" htmlFor="p-subject">Subject</label>
      <input
        id="p-subject"
        className="p-input"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Brief summary of your request"
        disabled={submitting}
        maxLength={200}
      />

      <label className="p-label" htmlFor="p-body">Details</label>
      <textarea
        id="p-body"
        className="p-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Describe what you need or what's going wrong…"
        disabled={submitting}
        rows={8}
      />

      {error && <div className="p-err">{error}</div>}

      <div className="p-form-foot">
        <button
          type="button"
          className="p-btn"
          onClick={submit}
          disabled={submitting || !subject.trim()}
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </div>
  );
}
