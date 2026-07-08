import ItilList from '@/components/v2/ItilList';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function V2ProblemsPage() {
  await requireSectionPage('operations');
  return (
    <ItilList
      kind="problem"
      title="Problems"
      subtitle="Root-cause investigations behind recurring incidents"
    />
  );
}
