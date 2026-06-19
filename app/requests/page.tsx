import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { LiveBadge } from '@/components/LiveBadge';
import { Breadcrumb } from '@/components/Breadcrumb';
import { MetricCards, sectionMetrics } from '@/components/MetricCards';

export const dynamic = 'force-dynamic';

export default async function RequestsPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('request');
  const open = rows.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  return (
    <div>
      <Breadcrumb items={[
        { label: 'Operations' },
        { label: 'Service management' },
        { label: 'Requests' },
      ]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Requests</div>
            <LiveBadge live={live} table="ops.tickets · request" note={note} />
          </div>
          <div className="sub">{open} open · service requests and access provisioning</div>
        </div>
      </div>

      <MetricCards metrics={sectionMetrics('request', rows)} />

      <SectionView kind="request" tickets={rows} />
    </div>
  );
}
