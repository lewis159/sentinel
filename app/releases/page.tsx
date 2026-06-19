import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { ReleasePipeline } from '@/components/ReleasePipeline';
import { LiveBadge } from '@/components/LiveBadge';
import { Breadcrumb } from '@/components/Breadcrumb';
import { MetricCards } from '@/components/MetricCards';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

export default async function ReleasesPage({
  searchParams,
}: { searchParams: Promise<{ ticket?: string }> }) {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('release');
  const inFlight = rows.filter((t) => t.status === 'building' || t.status === 'staged').length;
  const { ticket } = await searchParams;

  return (
    <div>
      <AutoRefresh source="release" />
      <Breadcrumb items={[
        { label: 'Operations' },
        { label: 'Service management' },
        { label: 'Releases' },
      ]} />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Releases</div>
            <LiveBadge live={live} table="ops.tickets · release" note={note} />
          </div>
          <div className="sub">{inFlight} in flight · deployment records, linked to changes</div>
        </div>
      </div>

      <MetricCards kind="release" tickets={rows} />

      <div className="card mb">
        <div className="panel-h"><h3>Release pipeline</h3></div>
        <ReleasePipeline releases={rows} />
      </div>

      <SectionView kind="release" tickets={rows} initialSelected={ticket ?? null} />
    </div>
  );
}
