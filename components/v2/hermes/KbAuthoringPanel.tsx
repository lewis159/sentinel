'use client';

// Hermes · KB Auto-Authoring panel.
//
//   1. Loads ranked KB gaps from GET /api/v2/admin/kb-authoring.
//   2. Each gap card: theme, recurrence (frequency), current KB coverage, and the
//      example tickets (linking to /v2/support/<ref>).
//   3. "Draft article" → POST {action:'draft'} → renders a markdown preview.
//   4. "Propose to KB" → POST {action:'propose'} → queues a kb-article proposal for
//      human approval. Nothing publishes here.
//
// Namespaced v2-kba-* so nothing leaks; colours come from the v2 shell tokens.

import { useEffect, useState } from 'react';
import Link from 'next/link';

type GapExample = { ref: string; title: string; question: string; score: number };
type KbGap = {
  theme: string;
  suggestedTitle: string;
  frequency: number;
  bestKbScore: number;
  exampleTickets: GapExample[];
};
type DraftedArticle = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  slug: string;
  category: string;
  source: 'skeleton' | 'llm';
  model?: string;
};

type GapsResp = { ok: boolean; error?: string; gaps: KbGap[]; resolvedCount: number; brainEnabled: boolean };
type DraftResp = { ok: boolean; error?: string; article?: DraftedArticle; gap?: { theme: string; exampleRefs: string[] } };
type ProposeResp = { ok: boolean; error?: string; proposalId?: string | null; persisted?: boolean };

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function coveragePill(score: number): string {
  if (score < 0.15) return 'crit';
  if (score < 0.34) return 'high';
  return 'info';
}

export default function KbAuthoringPanel() {
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [brainOn, setBrainOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v2/admin/kb-authoring')
      .then((r) => r.json())
      .then((d: GapsResp) => {
        if (!d.ok) throw new Error(d.error ?? 'failed to load gaps');
        setGaps(d.gaps ?? []);
        setResolvedCount(d.resolvedCount ?? 0);
        setBrainOn(Boolean(d.brainEnabled));
      })
      .catch((e) => setError(e?.message ?? 'failed to load gaps'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="v2-kba">
      <div className="v2-kba-meta">
        <span className="v2-kba-sub">
          {loading ? 'Detecting gaps…' : `${gaps.length} gap${gaps.length === 1 ? '' : 's'} across ${resolvedCount} resolved ticket${resolvedCount === 1 ? '' : 's'}`}
        </span>
        <span className={`v2-pill ${brainOn ? 'ok' : 'info'}`}>
          {brainOn ? 'Brain on · LLM drafting' : 'Brain off · skeleton drafts'}
        </span>
      </div>

      {error && <div className="v2-kba-error">{error}</div>}

      {!loading && !error && gaps.length === 0 && (
        <div className="v2-card v2-kba-empty">
          No KB gaps detected — every resolved question maps to an existing article. Nice.
        </div>
      )}

      <div className="v2-kba-list">
        {gaps.map((g) => (
          <GapCard key={g.theme} gap={g} brainOn={brainOn} />
        ))}
      </div>
    </div>
  );
}

function GapCard({ gap, brainOn }: { gap: KbGap; brainOn: boolean }) {
  const [article, setArticle] = useState<DraftedArticle | null>(null);
  const [exampleRefs, setExampleRefs] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleDraft() {
    setDrafting(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/v2/admin/kb-authoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft', theme: gap.theme }),
      });
      const d: DraftResp = await res.json();
      if (!d.ok || !d.article) throw new Error(d.error ?? 'draft failed');
      setArticle(d.article);
      setExampleRefs(d.gap?.exampleRefs ?? gap.exampleTickets.map((e) => e.ref));
    } catch (e: any) {
      setErr(e?.message ?? 'draft failed');
    } finally {
      setDrafting(false);
    }
  }

  async function handlePropose() {
    if (!article) return;
    setProposing(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/v2/admin/kb-authoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'propose', article, exampleRefs }),
      });
      const d: ProposeResp = await res.json();
      if (!d.ok) throw new Error(d.error ?? 'propose failed');
      setMsg(
        d.persisted
          ? 'Proposed to the approval queue — awaiting human approval before it publishes.'
          : 'Draft accepted (no database in this environment — nothing persisted).',
      );
    } catch (e: any) {
      setErr(e?.message ?? 'propose failed');
    } finally {
      setProposing(false);
    }
  }

  return (
    <div className="v2-card v2-kba-card">
      <div className="v2-kba-chead">
        <div className="v2-kba-cmain">
          <div className="v2-kba-theme">{gap.theme}</div>
          <div className="v2-kba-title">{gap.suggestedTitle}</div>
        </div>
        <div className="v2-kba-metrics">
          <span className="v2-pill info" title="How often this gap recurs">
            ×{gap.frequency}
          </span>
          <span className={`v2-pill ${coveragePill(gap.bestKbScore)}`} title="Best current KB match">
            KB {pct(gap.bestKbScore)}
          </span>
        </div>
      </div>

      <div className="v2-kba-examples">
        {gap.exampleTickets.map((e) => (
          <Link key={e.ref} href={`/v2/support/${e.ref}`} className="v2-kba-ex" title={e.question}>
            <span className="v2-kba-exref">{e.ref}</span>
            <span className="v2-kba-extitle">{e.title}</span>
          </Link>
        ))}
      </div>

      <div className="v2-kba-actions">
        <button className="v2-btn" onClick={handleDraft} disabled={drafting}>
          {drafting ? 'Drafting…' : article ? 'Re-draft article' : 'Draft article'}
        </button>
        {article && (
          <button className="v2-btn ghost" onClick={handlePropose} disabled={proposing}>
            {proposing ? 'Proposing…' : 'Propose to KB'}
          </button>
        )}
        {article && (
          <span className={`v2-pill ${article.source === 'llm' ? 'ok' : 'info'}`}>
            {article.source === 'llm' ? `LLM · ${article.model ?? 'model'}` : 'skeleton'}
          </span>
        )}
      </div>

      {err && <div className="v2-kba-error">{err}</div>}
      {msg && <div className="v2-kba-ok">{msg}</div>}

      {article && (
        <div className="v2-kba-preview">
          <div className="v2-kba-pmeta">
            <span className="v2-pill info">{article.category}</span>
            <span className="v2-kba-slug">/{article.slug}</span>
          </div>
          <pre className="v2-kba-md">{article.bodyMarkdown}</pre>
        </div>
      )}
    </div>
  );
}
