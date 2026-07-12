// Hermes · Agent Builder — spin up a NEW persona/skill from a plain-English brief.
//
// This is the META-feature: it drafts persona definitions. Safety is paramount, so
// it is admin-gated (requireSectionPage('admin') — the same section the Hermes
// governance / autonomy / testing surfaces use) and everything it produces is a
// DRAFT. New personas are created as drafts, default to advisory / read-only, and
// NEVER auto-go-live: approval records the decision but does NOT register the
// persona into the running set — activation is a separate, deliberate, manual code
// step. The interactive work lives in the <AgentBuilder/> client component; nothing
// here holds secrets or DB handles.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import AgentBuilder from '@/components/v2/hermes/AgentBuilder';
import '../../settings/settings.css';
import './agent-builder.css';

export const dynamic = 'force-dynamic';

export default async function HermesAgentBuilderPage() {
  await requireSectionPage('admin');

  return (
    <div>
      <Link href="/v2/hermes/governance" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes governance
      </Link>

      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Hermes · Admin</div>
          <h1 className="v2-h1">Agent Builder</h1>
          <div className="v2-sub">
            Describe a new agent in plain English and the builder drafts a persona — a SOUL, a
            read-only tool set, a section. Every persona is created as a draft that a human reviews
            and approves; approval is never activation.
          </div>
        </div>
      </div>

      <AgentBuilder />
    </div>
  );
}
