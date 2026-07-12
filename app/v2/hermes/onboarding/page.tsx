// Hermes · Onboarding assistant — guide new customers to first success and
// surface unused features on their tier, with a gated "draft nudge" flow.
//
// Gated by the `hermes` section (requireSectionPage). Server component: it
// computes the board (deterministic, mock-safe) and hands it to the client
// board for the interactive draft/queue flow. Dormant-safe — the milestone /
// feature-gap computation always runs; the LLM only personalises nudge text
// when HERMES_BRAIN_ENABLED is on.
import { requireSectionPage } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { getOnboardingBoard } from '@/lib/onboarding/data';
import OnboardingBoard from '@/components/v2/onboarding/OnboardingBoard';
import './onboarding.css';

export const dynamic = 'force-dynamic';

export default async function HermesOnboardingPage() {
  await requireSectionPage('hermes');

  const { customers, live } = await getOnboardingBoard();
  const brain = brainEnabled();

  return (
    <div>
      <div className="v2-eyebrow">Hermes · Growth</div>
      <h1 className="v2-h1">Onboarding assistant</h1>
      <div className="v2-sub">
        Guide new customers to their first win and surface the features they
        haven&apos;t tried yet · nudges are{' '}
        <span className="v2-onb-green">drafted, never auto-sent</span>
      </div>

      <div className="v2-onb-toolbar">
        <span className={`v2-pill ${brain ? 'ok' : 'info'} v2-onb-brain`}>
          {brain ? 'Brain on · nudges personalised' : 'Brain off · template nudges'}
        </span>
        {!live && (
          <span className="v2-onb-demo">Demo data — live customers in production</span>
        )}
      </div>

      <OnboardingBoard customers={customers} brainEnabled={brain} />

      <div className="v2-onb-foot">
        Milestones &amp; feature gaps are computed deterministically for every
        customer. Drafting a nudge queues it to the approval gate — nothing is
        sent until a human approves.
      </div>
    </div>
  );
}
