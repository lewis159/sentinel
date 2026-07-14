import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import './kb.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Sentinel v2 — Knowledge base index. There is no published-article store behind
// v2 yet (no ops.kb_articles table; the Hermes RAG chunks in hermes.kb_chunks and
// the file-based product docs in content/kb are a different surface), so the
// previously hardcoded article cards, category counts and "2 Hermes drafts"
// badge have been removed rather than shown as if they were a real, dated index.
// An honest empty state renders until a KB article store is wired. The drafts
// route is a real destination and is kept, without a fabricated count.
// ---------------------------------------------------------------------------

export default async function V2KbPage() {
  await requireSectionPage('overview');

  return (
    <div className="v2-kb-page">
      {/* Header */}
      <div className="v2-kb-head-row">
        <div>
          <div className="v2-eyebrow">Knowledge base</div>
          <h1 className="v2-h1">Knowledge base</h1>
          <div className="v2-sub">Runbooks, remediation guides and Hermes-authored articles across the estate.</div>
        </div>
      </div>

      {/* Drafts link (real route) */}
      <Link href="/v2/kb/drafts" className="v2-kb-banner">
        <span className="v2-kb-banner-txt">
          <b>Review Hermes drafts</b>
          <span>The support copilot turns recurring tickets into draft articles for review before they publish.</span>
        </span>
        <span className="v2-kb-banner-cta">Open drafts →</span>
      </Link>

      {/* Empty state — no published article store yet */}
      <div className="v2-card">
        <div style={{ padding: '28px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          No knowledge-base articles yet. Published runbooks and remediation guides will
          appear here once a KB article store is wired. Articles are not shown until they
          come from a real source.
        </div>
      </div>
    </div>
  );
}
