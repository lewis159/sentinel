// Internal Knowledge Q&A — ask one question, get an answer synthesised across the
// estate's institutional knowledge (KB, resolved tickets, roadmap), with the sources
// it used. READ-ONLY, draft/answer only — no actions.
//
// Gated by the `hermes` section (requireSectionPage) — internal staff only. The
// interactive work is in <KnowledgeQa/>; the brain flag is resolved here so the
// dormant state renders without a round-trip (the ask route enforces it too).
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import KnowledgeQa from '@/components/v2/hermes/KnowledgeQa';
import '../../settings/settings.css';
import './knowledge.css';

export const dynamic = 'force-dynamic';

export default async function HermesKnowledgePage() {
  await requireSectionPage('hermes');
  const enabled = brainEnabled();

  return (
    <div>
      <Link href="/v2/hermes/floor" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes floor
      </Link>

      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Knowledge</div>
          <h1 className="v2-h1">Knowledge Q&amp;A</h1>
          <div className="v2-sub">
            Ask one question and get an answer synthesised across the estate&apos;s institutional
            knowledge — the knowledge base, resolved tickets and the roadmap. Read-only and grounded:
            every answer cites the sources it used, and says &ldquo;I don&apos;t know&rdquo; rather than guessing.
          </div>
        </div>
      </div>

      <KnowledgeQa brainEnabled={enabled} />
    </div>
  );
}
