import Link from 'next/link';
import { requirePortalSession } from '@/lib/portal/auth';
import { NewTicketForm } from '@/components/portal/NewTicketForm';

export const dynamic = 'force-dynamic';

export default async function PortalNewTicket() {
  // Gate: signed in WITH an active tenant, else redirect (sign-in / no-access).
  await requirePortalSession();

  return (
    <div>
      <div className="p-crumb">
        <Link href="/portal">My tickets</Link> · <b>New request</b>
      </div>

      <div className="p-page-head">
        <h1 className="p-h1">New request</h1>
        <div className="p-sub">Tell us what you need and we'll get back to you here.</div>
      </div>

      <div className="p-card">
        <NewTicketForm />
      </div>
    </div>
  );
}
