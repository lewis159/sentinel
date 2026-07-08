import './security.css';
import { requireSectionPage } from '@/lib/auth';
import SecurityBoard from '@/components/v2/SecurityBoard';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Security (posture + findings). Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// The posture tiles, findings list, coverage bars and scan feed now live on a
// customizable widget board (SecurityBoard → WidgetGrid), mirroring the Estate
// overview and Operations boards. Data is LIVE via GET /api/v2/security (widgets
// read it through a shared SWR hook); see components/v2/widgets/security.tsx.
export default async function V2SecurityPage() {
  await requireSectionPage('security');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Security</div>
        <h1 className="v2-h1">Security posture</h1>
        <div className="v2-sub">Findings, scan coverage and recent runs across the estate</div>
      </div>

      {/* Customizable widget board */}
      <SecurityBoard />
    </div>
  );
}
