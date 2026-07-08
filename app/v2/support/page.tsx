import './support.css';
import SupportTable from '@/components/v2/SupportTable';
import { NewTicketButton } from '@/components/v2/NewTicketModal';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const chips: { label: string; count: number; on?: boolean }[] = [
  { label: 'All open', count: 18, on: true },
  { label: 'Assigned to me', count: 5 },
  { label: 'SLA at risk', count: 4 },
  { label: 'Billing', count: 6 },
  { label: 'Technical', count: 9 },
];

export default async function V2SupportPage() {
  await requireSectionPage('support');

  return (
    <div className="v2-sup-page">
      {/* Header */}
      <div className="spread" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="v2-eyebrow">Support</div>
          <h1 className="v2-h1">Customer desk</h1>
          <div className="v2-sub">18 open · 4 at SLA risk · assigned to you: 5</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="v2-btn ghost">Views</button>
          <NewTicketButton className="v2-btn" label="New ticket" />
        </div>
      </div>

      {/* Filter chips */}
      <div className="v2-sup-chips">
        {chips.map((c) => (
          <button key={c.label} className={`v2-sup-chip${c.on ? ' on' : ''}`}>
            {c.label} <span className="ct">· {c.count}</span>
          </button>
        ))}
      </div>

      {/* Ticket table (live via SWR) */}
      <SupportTable />
    </div>
  );
}
