import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

export default async function ReleasesPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('release');
  const inFlight = rows.filter((t) => t.status === 'building' || t.status === 'staged').length;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Releases</div>
            <LiveBadge live={live} table="ops.tickets · release" note={note} />
          </div>
          <div className="sub">{inFlight} in flight · deployment records, linked to changes</div>
        </div>
        <button className="btn sm">+ Plan release</button>
      </div>

      <SectionView kind="release" tickets={rows} />
    </div>
  );
}
