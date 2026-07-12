'use client';

// Internal Knowledge Q&A — the interactive surface.
//
// A staff user types one question; we POST /api/v2/admin/knowledge/ask and render
// the grounded answer plus the sources the Brain cited (KB slugs / ticket refs /
// roadmap items), each linking to where it can be read in the console.
//
// The `brainEnabled` prop is resolved on the server (page) so the disabled state
// renders without a round-trip; the route ALSO enforces the flag, so this is only
// a UX hint. Namespaced v2-kq-* so nothing leaks.

import { useState } from 'react';

type Source = {
  type: 'kb' | 'ticket' | 'roadmap';
  ref: string;
  title: string;
  href?: string;
};

type AskResponse = {
  status: 'answered' | 'disabled' | 'error';
  answer: string;
  sources?: Source[];
  model?: string;
  error?: string;
};

const TYPE_LABEL: Record<Source['type'], string> = {
  kb: 'KB',
  ticket: 'Ticket',
  roadmap: 'Roadmap',
};

export default function KnowledgeQa({ brainEnabled }: { brainEnabled: boolean }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v2/admin/knowledge/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data: AskResponse = await res.json();
      setResult(data);
    } catch {
      setError('Could not reach the knowledge service. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!brainEnabled) {
    return (
      <div className="v2-kq-banner">
        <b>Knowledge Q&amp;A is dormant.</b> The Hermes Brain is disabled, so questions
        cannot be answered yet. Set <code>HERMES_BRAIN_ENABLED</code> and a model key,
        then this page goes live — no redeploy of this feature is needed.
      </div>
    );
  }

  return (
    <div>
      <form className="v2-kq-form" onSubmit={ask}>
        <textarea
          className="v2-kq-input"
          placeholder="Ask anything about the estate — e.g. “How do we recover a stalled transcription worker?” or “What's the plan for HA Postgres?”"
          value={question}
          onChange={(ev) => setQuestion(ev.target.value)}
          onKeyDown={(ev) => {
            if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') ask();
          }}
          disabled={loading}
        />
        <div className="v2-kq-row">
          <button className="v2-kq-btn" type="submit" disabled={loading || !question.trim()}>
            {loading ? 'Searching estate…' : 'Ask'}
          </button>
          <span className="v2-kq-hint">
            Answers are grounded in the KB, resolved tickets and the roadmap — with sources.
          </span>
        </div>
      </form>

      {error && <div className="v2-kq-error">{error}</div>}

      {result && result.status === 'disabled' && (
        <div className="v2-kq-banner">{result.answer}</div>
      )}

      {result && result.status === 'error' && (
        <div className="v2-kq-error">{result.answer || result.error || 'Something went wrong.'}</div>
      )}

      {result && result.status === 'answered' && (
        <div className="v2-kq-answer">
          <div className="v2-kq-answer-label">Answer</div>
          <div className="v2-kq-answer-body">{result.answer}</div>

          <div className="v2-kq-sources">
            <div className="v2-kq-sources-label">Sources</div>
            {result.sources && result.sources.length > 0 ? (
              <div className="v2-kq-source-list">
                {result.sources.map((s) => {
                  const inner = (
                    <>
                      <span className="v2-kq-source-tag">{TYPE_LABEL[s.type]}</span>
                      <span className="v2-kq-source-ref">{s.ref}</span>
                      <span className="v2-kq-source-title">{s.title}</span>
                    </>
                  );
                  return s.href ? (
                    <a key={`${s.type}:${s.ref}`} className="v2-kq-source" href={s.href}>
                      {inner}
                    </a>
                  ) : (
                    <div key={`${s.type}:${s.ref}`} className="v2-kq-source">
                      {inner}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="v2-kq-none">
                No sources cited — treat this answer with care and verify against the estate.
              </div>
            )}
          </div>

          {result.model && <div className="v2-kq-model">Model: {result.model}</div>}
        </div>
      )}
    </div>
  );
}
