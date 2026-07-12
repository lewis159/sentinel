'use client';

// Client affordances for the board-update draft: copy the markdown to the
// clipboard, regenerate a fresh draft, and save the draft to the proposal queue
// (kind 'board-update'). SAVE PERSISTS A DRAFT ONLY — nothing is sent; the founder
// reviews and sends by hand. On save/regenerate we refresh the server component so
// the rendered draft reflects the latest assembly.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function BoardUpdateActions({ markdown }: { markdown: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatus('Copy failed — select the draft text and copy manually.');
    }
  }

  async function post(action: 'save' | 'regenerate') {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/v2/admin/board-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(json?.error ?? `Request failed (${res.status}).`);
      } else if (action === 'save') {
        setStatus(json?.ok ? 'Draft saved to the approval queue — review and send manually.' : json?.note ?? 'Draft not persisted.');
      } else {
        setStatus('Draft regenerated.');
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setStatus(e?.message ?? 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-bu-actions">
      <button type="button" className="v2-bu-btn" onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy markdown'}
      </button>
      <button type="button" className="v2-bu-btn" disabled={busy} onClick={() => post('regenerate')}>
        Regenerate
      </button>
      <button type="button" className="v2-bu-btn v2-bu-btn-primary" disabled={busy} onClick={() => post('save')}>
        Save draft
      </button>
      {status && <span className="v2-bu-status">{status}</span>}
    </div>
  );
}
