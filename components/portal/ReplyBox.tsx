'use client';

// Customer reply box — posts to /api/portal/tickets/[ref]/comments. The server
// forces kind='customer', visibility='external'; this form only carries the text.
// After a successful post it calls router.refresh() so the timeline re-renders.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const NO_DB = "Couldn't send — this environment has no database.";

export function ReplyBox({ refId }: { refId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body || posting) return;

    setPosting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/tickets/${encodeURIComponent(refId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(res.status >= 500 ? NO_DB : data?.error || `Send failed (${res.status}).`);
        setPosting(false);
        return;
      }
      setText('');
      setPosting(false);
      router.refresh();
    } catch {
      setError('Network error — could not send your reply.');
      setPosting(false);
    }
  }

  return (
    <div className="p-reply">
      <textarea
        className="p-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        disabled={posting}
        rows={4}
      />
      {error && <div className="p-err">{error}</div>}
      <div className="p-reply-foot">
        <span className="p-hint">Your reply is shared with the support team.</span>
        <button
          type="button"
          className="p-btn"
          onClick={send}
          disabled={posting || !text.trim()}
        >
          {posting ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </div>
  );
}
