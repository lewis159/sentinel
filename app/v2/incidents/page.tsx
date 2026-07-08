import ItilList from '@/components/v2/ItilList';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function V2IncidentsPage() {
  await requireSectionPage('operations');
  return (
    <ItilList
      kind="incident"
      title="Incidents"
      subtitle="Unplanned interruptions and service degradations"
    />
  );
}
