'use client';

import dynamic from 'next/dynamic';
import { type ServiceTicket } from '@/lib/mock';
import { ApplyGrantButton } from './ApplyGrantButton';

// react-grid-layout is client-only (touches window/ResizeObserver). Load the
// dashboard body via a dynamic import with ssr:false so `next build` never tries
// to render the grid on the server. A lightweight skeleton holds the space until
// the client chunk hydrates.
const TicketDashboard = dynamic(() => import('./TicketDashboard').then((m) => m.TicketDashboard), {
  ssr: false,
  loading: () => <div className="sub" style={{ padding: 8 }}>Loading layout…</div>,
});

// Status → theme token. Tokens re-theme per palette (the severity hues are
// nudged darker for light/slate), so statuses read correctly on every theme.
const statusColor: Record<string, string> = {
  open: 'var(--low)', draft: 'var(--muted)', in_progress: 'var(--high)', investigating: 'var(--high)',
  awaiting_cab: 'var(--high)', building: 'var(--high)', planned: 'var(--low)', scheduled: 'var(--low)',
  blocked: 'var(--muted)', approved: 'var(--ok)', implemented: 'var(--ok)', deployed: 'var(--ok)',
  verified: 'var(--ok)', fulfilled: 'var(--ok)', known_error: 'var(--crit)', resolved: 'var(--ok)',
  staged: 'var(--low)', closed: 'var(--muted)',
};

// Renders the ITIL field set for one record as a draggable/resizable dashboard.
// The title/summary now lives INSIDE the grid as the Summary tile; only a minimal
// non-draggable reference line stays outside it.
export function TicketDetail({ t }: { t: ServiceTicket }) {
  return (
    <div>
      {/* Minimal, non-draggable reference line (the title lives in the Summary tile) */}
      <div className="spread mb">
        <span className="mono">{t.ref}</span>
        {/* Access-provisioning requests get an "Apply grant" action (global_admin). */}
        {t.kind === 'request' && t.source === 'access-mgmt' && <ApplyGrantButton ref={t.ref} />}
      </div>

      <TicketDashboard t={t} />
    </div>
  );
}

// Shared status colour map for the metadata panel (exported for the dashboard).
export { statusColor };
