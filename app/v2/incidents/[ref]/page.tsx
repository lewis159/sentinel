import ServiceTicketDetail from '@/components/v2/ServiceTicketDetail';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Incident detail — real ITIL record via the shared ServiceTicketDetail pane
// (getServiceTicket/getTicketComments/getTicketEdges, DB-first). Renders a
// graceful "not found" card when the ref doesn't resolve. Previously this route
// rendered a hardcoded INC-204 incident that ignored the ref; it now shows the
// real record for {ref}, matching the request/problem/release detail routes.
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('operations');
  const { ref } = await params;
  return <ServiceTicketDetail refId={ref} kind="incident" />;
}
