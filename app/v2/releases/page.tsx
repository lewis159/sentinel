import ItilList from '@/components/v2/ItilList';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function V2ReleasesPage() {
  await requireSectionPage('operations');
  return (
    <ItilList
      kind="release"
      title="Releases"
      subtitle="Planned deployments rolling out across the estate"
    />
  );
}
