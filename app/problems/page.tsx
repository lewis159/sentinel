import { getTicketsByKind } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { SectionView } from '@/components/SectionView';
import { LiveBadge } from '@/components/LiveBadge';
import { Breadcrumb } from '@/components/Breadcrumb';
import { MetricCards } from '@/components/MetricCards';
import { AutoRefresh } from '@/components/AutoRefresh';
import { EditModeProvider, EditModeToggle } from '@/components/EditMode';

export const dynamic = 'force-dynamic';

export default async function ProblemsPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getTicketsByKind('problem');
  const knownErrors = rows.filter((t) => t.status === 'known_error').length;

  return (
    <div>
      <AutoRefresh source="problem" />
      <Breadcrumb items={[
        { label: 'Operations' },
        { label: 'Service management' },
        { label: 'Problems' },
      ]} />
      <EditModeProvider>
        <div className="spread mb">
          <div>
            <div className="row" style={{ gap: 10 }}>
              <div className="h1">Problems</div>
              <LiveBadge live={live} table="ops.tickets · problem" note={note} />
            </div>
            <div className="sub">{knownErrors} known errors · root-cause records behind recurring incidents</div>
          </div>
          <EditModeToggle />
        </div>

        <MetricCards kind="problem" tickets={rows} />
        <SectionView kind="problem" tickets={rows} />
      </EditModeProvider>
    </div>
  );
}
