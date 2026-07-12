// Hermes · Market & Content — one admin-gated surface with two sections:
//
//   A. Competitors — the tracked competitor set (cards with positioning/pricing
//      notes). "Scan for changes" drafts a competitive brief → the Approvals queue.
//   B. Content     — from a target keyword + type (blog/help/landing) draft SEO
//      copy: preview a skeleton (always) or, with the Brain on, a full body, then
//      "queue" the draft as a proposal.
//
// Gated by the `hermes` section (requireSectionPage), same as the rest of the
// Hermes console. DRAFT-ONLY, read-only sources, NO live web fetch — everything
// is LLM reasoning over the operator-maintained config in lib/market/config.ts.
// The interactive work lives in the <MarketConsole/> client component; nothing
// here holds secrets or DB handles.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import MarketConsole from '@/components/v2/hermes/MarketConsole';
import '../../settings/settings.css';
import './market.css';

export const dynamic = 'force-dynamic';

export default async function HermesMarketPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      <Link href="/v2/hermes/floor" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes floor
      </Link>

      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Market</div>
          <h1 className="v2-h1">Market &amp; Content</h1>
          <div className="v2-sub">
            Track competitors and draft SEO content. Sources are operator-maintained and read-only —
            scans and drafts are LLM-reasoned over stored notes, never live web data, and everything
            is a draft that must be reviewed. Nothing here publishes.
          </div>
        </div>
      </div>

      <MarketConsole />
    </div>
  );
}
