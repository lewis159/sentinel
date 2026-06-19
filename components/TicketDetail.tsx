'use client';

import dynamic from 'next/dynamic';
import { type ServiceTicket } from '@/lib/mock';

// react-grid-layout is client-only (touches window/ResizeObserver). Load the
// dashboard body via a dynamic import with ssr:false so `next build` never tries
// to render the grid on the server. A lightweight skeleton holds the space until
// the client chunk hydrates.
const TicketDashboard = dynamic(() => import('./TicketDashboard').then((m) => m.TicketDashboard), {
  ssr: false,
  loading: () => <div className="sub" style={{ padding: 8 }}>Loading layout…</div>,
});

const statusColor: Record<string, string> = {
  open: '#7fa8ff', draft: '#aab3c4', in_progress: '#ffc05a', investigating: '#ffc05a',
  awaiting_cab: '#ffc05a', building: '#ffc05a', planned: '#7fa8ff', scheduled: '#7fa8ff',
  blocked: 'var(--muted)', approved: '#5fd49b', implemented: '#5fd49b', deployed: '#5fd49b',
  verified: '#5fd49b', fulfilled: '#5fd49b', known_error: '#ff8b8e', resolved: '#5fd49b',
  staged: '#7fa8ff', closed: 'var(--muted)',
};

// Renders the ITIL field set for one record as a draggable/resizable dashboard.
// The title/summary now lives INSIDE the grid as the Summary tile; only a minimal
// non-draggable reference line stays outside it.
export function TicketDetail({ t }: { t: ServiceTicket }) {
  return (
    <div>
      {/* Minimal, non-draggable reference line (the title lives in the Summary tile) */}
      <div className="row mb" style={{ gap: 8 }}>
        <span className="mono">{t.ref}</span>
      </div>

      <TicketDashboard t={t} />
    </div>
  );
}

// Shared status colour map for the metadata panel (exported for the dashboard).
export { statusColor };
