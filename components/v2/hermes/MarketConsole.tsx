'use client';

// Hermes · Market & Content console — two tabs on one surface:
//
//   A. Competitors — cards from the operator-maintained config; "Scan for
//      changes" POSTs { action:'scan-competitor' } → drafts a competitive brief
//      into the Approvals queue and previews it inline.
//   B. Content     — a keyword + type picker; "Draft" POSTs { action:'draft-content',
//      commit:false } for a preview, then "Queue draft" re-POSTs with commit:true
//      to persist a content-draft proposal.
//
// DRAFT-ONLY: the console never publishes; queued items are proposals a human
// approves elsewhere. Every scan/draft is stamped "not live web data". Namespaced
// v2-mkt-* so nothing leaks; colours come from the shell tokens.

import { useEffect, useState } from 'react';

type Competitor = {
  slug: string;
  name: string;
  url: string;
  positioning: string;
  pricingNotes: string;
  lastReviewed: string;
};
type ContentType = 'blog' | 'help' | 'landing';

type Config = {
  ok: boolean;
  brainEnabled: boolean;
  operatorMaintained: boolean;
  liveWebSourceWired: boolean;
  contentTypes: ContentType[];
  competitors: Competitor[];
  keywords: string[];
};

type Brief = {
  name: string;
  analysis: string;
  analysisSource: 'model' | 'notes';
  disclaimer: string;
};
type Draft = {
  title: string;
  type: ContentType;
  keyword: string;
  metaDescription: string;
  outline: string[];
  body: string | null;
  bodySource: 'model' | 'skeleton';
  grounded: string[];
  note: string;
};

// ── Competitors tab ──────────────────────────────────────────────────────────
function CompetitorsTab({ config }: { config: Config }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, { brief: Brief; queued: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  async function scan(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const res = await fetch('/api/v2/admin/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan-competitor', slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? `Scan failed (HTTP ${res.status})`);
        return;
      }
      setBriefs((b) => ({ ...b, [slug]: { brief: data.brief, queued: Boolean(data.proposalId) } }));
    } catch {
      setError('Network error while scanning.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="v2-mkt-grid">
      {error ? <div className="v2-mkt-err">{error}</div> : null}
      {config.competitors.map((c) => {
        const result = briefs[c.slug];
        return (
          <div key={c.slug} className="v2-card v2-mkt-card">
            <div className="v2-mkt-chead">
              <div>
                <div className="v2-mkt-cname">{c.name}</div>
                <a className="v2-mkt-curl" href={c.url} target="_blank" rel="noreferrer">
                  {c.url.replace(/^https?:\/\//, '')}
                </a>
              </div>
              <button className="v2-btn" disabled={busy === c.slug} onClick={() => void scan(c.slug)}>
                {busy === c.slug ? 'Scanning…' : 'Scan for changes'}
              </button>
            </div>

            <div className="v2-mkt-note">
              <span className="v2-mkt-label">Positioning</span>
              {c.positioning}
            </div>
            <div className="v2-mkt-note">
              <span className="v2-mkt-label">Pricing</span>
              {c.pricingNotes}
            </div>
            <div className="v2-mkt-meta">Last reviewed {c.lastReviewed}</div>

            {result ? (
              <div className="v2-mkt-brief">
                <div className="v2-mkt-briefhead">
                  <span className={`v2-pill ${result.brief.analysisSource === 'model' ? 'ok' : 'info'}`}>
                    {result.brief.analysisSource === 'model' ? 'AI analysis' : 'from notes'}
                  </span>
                  {result.queued ? (
                    <span className="v2-mkt-queued">Draft queued in Approvals →</span>
                  ) : (
                    <span className="v2-mkt-queued muted">Draft ready (no DB — not persisted)</span>
                  )}
                </div>
                <div className="v2-mkt-disclaimer">{result.brief.disclaimer}</div>
                <pre className="v2-mkt-pre">{result.brief.analysis}</pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Content tab ──────────────────────────────────────────────────────────────
function ContentTab({ config }: { config: Config }) {
  const [keyword, setKeyword] = useState(config.keywords[0] ?? '');
  const [type, setType] = useState<ContentType>('blog');
  const [busy, setBusy] = useState<'draft' | 'queue' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(commit: boolean) {
    if (!keyword.trim()) {
      setError('Enter a target keyword.');
      return;
    }
    setBusy(commit ? 'queue' : 'draft');
    setError(null);
    try {
      const res = await fetch('/api/v2/admin/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft-content', keyword: keyword.trim(), type, commit }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? `Draft failed (HTTP ${res.status})`);
        return;
      }
      setDraft(data.draft);
      setQueued(commit && Boolean(data.proposalId));
    } catch {
      setError('Network error while drafting.');
    } finally {
      setBusy(null);
    }
  }

  const preview = draft?.body ?? null;

  return (
    <div className="v2-mkt-content">
      <div className="v2-card v2-mkt-form">
        <div className="v2-set-field">
          <label className="v2-set-label" htmlFor="mkt-kw">
            Target keyword
          </label>
          <input
            id="mkt-kw"
            className="v2-set-input"
            list="mkt-keywords"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setDraft(null);
              setQueued(false);
            }}
            placeholder="e.g. youtube video transcription"
          />
          <datalist id="mkt-keywords">
            {config.keywords.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>

        <div className="v2-set-field">
          <label className="v2-set-label" htmlFor="mkt-type">
            Content type
          </label>
          <select
            id="mkt-type"
            className="v2-set-input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ContentType);
              setDraft(null);
              setQueued(false);
            }}
          >
            {config.contentTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'blog' ? 'Blog post' : t === 'help' ? 'Help article' : 'Landing copy'}
              </option>
            ))}
          </select>
        </div>

        <div className="v2-mkt-actions">
          <button className="v2-btn ghost" disabled={busy !== null} onClick={() => void run(false)}>
            {busy === 'draft' ? 'Drafting…' : 'Draft (preview)'}
          </button>
          <button className="v2-btn" disabled={busy !== null || !draft} onClick={() => void run(true)}>
            {busy === 'queue' ? 'Queueing…' : 'Queue draft'}
          </button>
        </div>
        {!config.brainEnabled ? (
          <div className="v2-mkt-hint">
            Hermes Brain is off — previews show the deterministic skeleton only. Enable{' '}
            <code>HERMES_BRAIN_ENABLED</code> for a full drafted body.
          </div>
        ) : null}
      </div>

      {error ? <div className="v2-mkt-err">{error}</div> : null}

      {draft ? (
        <div className="v2-card v2-mkt-preview">
          <div className="v2-mkt-briefhead">
            <span className={`v2-pill ${draft.bodySource === 'model' ? 'ok' : 'info'}`}>
              {draft.bodySource === 'model' ? 'AI body' : 'skeleton'}
            </span>
            {queued ? <span className="v2-mkt-queued">Draft queued in Approvals →</span> : null}
          </div>

          <h3 className="v2-mkt-ptitle">{draft.title}</h3>
          <div className="v2-mkt-note">
            <span className="v2-mkt-label">Meta</span>
            {draft.metaDescription}
          </div>
          <div className="v2-mkt-note">
            <span className="v2-mkt-label">Outline</span>
            <ul className="v2-mkt-outline">
              {draft.outline.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
          {draft.grounded.length ? (
            <div className="v2-mkt-meta">Grounded in KB: {draft.grounded.join(', ')}</div>
          ) : null}
          {preview ? (
            <>
              <div className="v2-mkt-label" style={{ marginTop: 10 }}>
                Body
              </div>
              <pre className="v2-mkt-pre">{preview}</pre>
            </>
          ) : null}
          <div className="v2-mkt-disclaimer">{draft.note}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function MarketConsole() {
  const [config, setConfig] = useState<Config | null>(null);
  const [tab, setTab] = useState<'competitors' | 'content'>('competitors');
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v2/admin/market')
      .then((r) => r.json())
      .then((d) => (d?.ok ? setConfig(d) : setLoadErr(d?.error ?? 'Failed to load config.')))
      .catch(() => setLoadErr('Network error loading market config.'));
  }, []);

  if (loadErr) return <div className="v2-mkt-err">{loadErr}</div>;
  if (!config) return <div className="v2-mkt-empty">Loading…</div>;

  return (
    <div className="v2-mkt">
      <div className="v2-mkt-tabs">
        <button
          className={`v2-mkt-tab ${tab === 'competitors' ? 'active' : ''}`}
          onClick={() => setTab('competitors')}
        >
          Competitors <span className="v2-mkt-count">{config.competitors.length}</span>
        </button>
        <button
          className={`v2-mkt-tab ${tab === 'content' ? 'active' : ''}`}
          onClick={() => setTab('content')}
        >
          Content <span className="v2-mkt-count">{config.keywords.length}</span>
        </button>
        {!config.liveWebSourceWired ? (
          <span className="v2-mkt-src">No live web source wired — analysis from stored notes only</span>
        ) : null}
      </div>

      {tab === 'competitors' ? <CompetitorsTab config={config} /> : <ContentTab config={config} />}
    </div>
  );
}
