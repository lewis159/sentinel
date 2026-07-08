import ServiceTicketDetail from '@/components/v2/ServiceTicketDetail';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function V2ProblemDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('operations');
  const { ref } = await params;
  return <ServiceTicketDetail refId={ref} kind="problem" />;
}
