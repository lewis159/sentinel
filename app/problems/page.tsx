import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { LiveBadge } from '@/components/LiveBadge';

export const dynamic = 'force-dynamic';

export default async function ProblemsPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('problem');
  const knownErrors = rows.filter((t) => t.status === 'known_error').length;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Problems</div>
            <LiveBadge live={live} table="ops.tickets · problem" note={note} />
          </div>
          <div className="sub">{knownErrors} known errors · root-cause records behind recurring incidents</div>
        </div>
        <button className="btn sm">+ Log problem</button>
      </div>

      <SectionView kind="problem" tickets={rows} />
    </div>
  );
}
