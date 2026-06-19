import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { LiveBadge } from '@/components/LiveBadge';
import { Breadcrumb } from '@/components/Breadcrumb';
import { MetricCards, sectionMetrics } from '@/components/MetricCards';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('incident');
  const open = rows.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  return (
    <div>
      <Breadcrumb items={[
        { label: 'Operations' },
        { label: 'Service management' },
        { label: 'Incidents' },
      ]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Incidents</div>
            <LiveBadge live={live} table="ops.tickets · incident" note={note} />
          </div>
          <div className="sub">{open} open · unplanned interruptions to service</div>
        </div>
      </div>

      <MetricCards metrics={sectionMetrics('incident', rows)} />

      <SectionView kind="incident" tickets={rows} />
    </div>
  );
}
