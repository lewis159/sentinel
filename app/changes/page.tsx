import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { ChangesSection } from '@/components/ChangesSection';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

export default async function ChangesPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('change');
  const awaitingCab = rows.filter((t) => t.status === 'awaiting_cab').length;
  const pendingCab = rows.filter((t) => (t.attrs?.cab_status ?? '') === 'pending').length;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Changes</div>
            <LiveBadge live={live} table="ops.tickets · change" note={note} />
          </div>
          <div className="sub">{awaitingCab} awaiting CAB · {pendingCab} pending approval · RFCs, calendar and CAB queue</div>
        </div>
        <button className="btn sm">+ Raise change</button>
      </div>

      <ChangesSection changes={rows} />
    </div>
  );
}
