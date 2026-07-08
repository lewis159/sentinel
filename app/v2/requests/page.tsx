import ItilList from '@/components/v2/ItilList';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function V2RequestsPage() {
  await requireSectionPage('operations');
  return (
    <ItilList
      kind="request"
      title="Requests"
      subtitle="Service requests and access approvals"
    />
  );
}
