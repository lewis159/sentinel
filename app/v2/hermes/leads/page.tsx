import { requireSectionPage } from '@/lib/auth';
import LeadsPipeline from '@/components/v2/LeadsPipeline';
import './leads.css';

export const dynamic = 'force-dynamic';

// Sales / Lead-qualification pipeline. Gated by the Hermes section. Inbound
// enquiries (POST /api/public/leads) are scored deterministically at intake and
// ranked hot → warm → cold here; the operator can draft a GROUNDED pre-sale
// reply that lands in the Approvals queue (gated — never auto-sent).
export default async function HermesLeadsPage() {
  await requireSectionPage('hermes');

  return (
    <div>
      <div className="v2-eyebrow">Hermes · Sales</div>
      <h1 className="v2-h1">Lead pipeline</h1>
      <div className="v2-sub">
        Inbound enquiries scored &amp; qualified · ranked{' '}
        <span className="v2-leads-inline hot">hot</span> →{' '}
        <span className="v2-leads-inline warm">warm</span> →{' '}
        <span className="v2-leads-inline cold">cold</span> · replies are drafted for
        approval, never auto-sent
      </div>

      <LeadsPipeline />
    </div>
  );
}
