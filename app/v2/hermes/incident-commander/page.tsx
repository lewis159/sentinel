// Hermes · Incident Commander — one surface for an active incident.
//
// Server component: section-gated ('hermes'), then renders the interactive
// <IncidentCommander/> client which loads active incidents + their assembled
// context from GET /api/v2/admin/incident-commander. Remediation/status posts are
// GATED (drafts flow through the proposals spine); opening an incident ticket is
// an additive operator action. Dormant-safe: reads real signals, drafts the
// status narrative with the LLM only when HERMES_BRAIN_ENABLED is on.
import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import IncidentCommander from '@/components/v2/hermes/IncidentCommander';
import './incident-commander.css';

export const dynamic = 'force-dynamic';

export default async function IncidentCommanderPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      <Link href="/v2/hermes/floor" className="v2-set-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Hermes floor
      </Link>

      <div className="v2-eyebrow">Hermes · Operations</div>
      <h1 className="v2-h1">Incident Commander</h1>
      <div className="v2-sub">
        On an active alert, open an incident, assemble the context (firing alerts, recent deploys, related tickets,
        monitoring), and draft a stakeholder status update. Status broadcasts are gated — nothing posts without your
        approval.
      </div>

      <IncidentCommander />
    </div>
  );
}
