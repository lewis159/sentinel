import './operations.css';
import { requireSectionPage } from '@/lib/auth';
import OperationsBoard from '@/components/v2/OperationsBoard';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Operations (estate monitoring). Renders inside the v2 shell
// (.v2-shell > .v2-content); this component provides page content only.
//
// The monitoring tiles now live on a customizable widget board (OperationsBoard
// → WidgetGrid), mirroring the Estate overview board. Data is static/mock inside
// the widget components (see components/v2/widgets/operations.tsx) so the page
// stays reliably buildable without live infra.
export default async function OperationsPage() {
  await requireSectionPage('operations');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Operations</div>
        <h1 className="v2-h1">Estate monitoring</h1>
        <div className="v2-sub">1 host · 6 services · 2 open incidents</div>
      </div>

      {/* Customizable widget board */}
      <OperationsBoard />
    </div>
  );
}
