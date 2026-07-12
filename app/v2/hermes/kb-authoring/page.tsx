// Hermes · KB Auto-Authoring — the support flywheel surface.
//
// Shows the ranked KB GAPS (resolved questions the knowledge base doesn't cover,
// clustered by theme) and lets an operator DRAFT a help-centre article for each
// and PROPOSE it to the approval queue. Nothing here publishes: a proposed article
// is a reviewable draft (kind:'kb-article') a human still has to approve.
//
// Gated by the `hermes` section (requireSectionPage), matching the rest of the
// Hermes console. The interactive work lives in the <KbAuthoringPanel/> client
// component; this server component holds no secrets or DB handles.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import KbAuthoringPanel from '@/components/v2/hermes/KbAuthoringPanel';
import '../../settings/settings.css';
import './kb-authoring.css';

export const dynamic = 'force-dynamic';

export default async function HermesKbAuthoringPage() {
  await requireSectionPage('hermes');

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
          <div className="v2-eyebrow">Hermes · Support flywheel</div>
          <h1 className="v2-h1">KB Authoring</h1>
          <div className="v2-sub">
            Where support hits a knowledge gap, draft the missing help-centre article. Gaps are detected
            from resolved tickets whose question the current KB can&rsquo;t answer — the more often a
            question recurs, the higher it ranks. Draft, review, and propose; publishing stays behind a
            human approval.
          </div>
        </div>
      </div>

      <KbAuthoringPanel />
    </div>
  );
}
