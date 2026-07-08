import { requireSectionPage } from '@/lib/auth';
import OverviewBoard from '@/components/v2/OverviewBoard';

export const dynamic = 'force-dynamic';

export default async function V2OverviewPage() {
  await requireSectionPage('overview');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Command</div>
        <h1 className="v2-h1">Estate overview</h1>
        <div className="v2-sub">
          Everything that needs a human · synced moments ago · 1 host · 6 services
        </div>
      </div>

      {/* Customizable widget board */}
      <OverviewBoard />
    </div>
  );
}
