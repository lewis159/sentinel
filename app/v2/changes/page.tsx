import './changes.css';
import { requireSectionPage } from '@/lib/auth';
import { getTicketsByKind } from '@/lib/data';
import type { ServiceTicket } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Change management. Renders inside the v2 shell
// (.v2-shell > .v2-content); this file supplies page content only.
//
// Real data: change records come from ops.tickets (kind='change') via
// getTicketsByKind('change') — DB-first, mock-safe (LIVE vs mock pill). The old
// fixed "July 2026" calendar grid + fabricated CAB rows have been removed: a
// month-grid calendar can't be honestly rendered from the free-text schedule
// window carried in attrs.window, so changes are surfaced as real lists instead.
// When there is no DB / no change tickets, honest empty states render — never
// fabricated sample rows.

type RiskTone = 'high' | 'crit' | 'info' | 'ok';

// attrs.risk (free text) → a pill tone + human label.
function riskOf(t: ServiceTicket): { tone: RiskTone; label: string } {
  const raw = String(t.attrs?.risk ?? t.priority ?? '').toLowerCase();
  if (raw.includes('crit')) return { tone: 'crit', label: 'Critical risk' };
  if (raw.includes('high')) return { tone: 'high', label: 'High risk' };
  if (raw.includes('low')) return { tone: 'ok', label: 'Low risk' };
  if (raw.includes('med')) return { tone: 'info', label: 'Medium risk' };
  return { tone: 'info', label: 'Risk not set' };
}

function windowOf(t: ServiceTicket): string {
  const w = t.attrs?.window;
  return w && String(w).trim() ? String(w) : 'Unscheduled';
}

function requesterOf(t: ServiceTicket): string {
  if (t.assignee && t.assignee !== '—') return t.assignee;
  return String(t.app ?? 'Estate');
}

// A change is "awaiting approval" until it's been approved/implemented/closed.
const CLOSED_CAB = new Set(['approved', 'implemented', 'closed', 'done', 'rejected']);
function awaitingCab(t: ServiceTicket): boolean {
  const cab = String(t.attrs?.cab_status ?? '').toLowerCase();
  const status = String(t.status ?? '').toLowerCase();
  if (cab) return !CLOSED_CAB.has(cab);
  return !CLOSED_CAB.has(status);
}

export default async function ChangeCalendarPage() {
  await requireSectionPage('operations');

  const { rows: changes, live } = await getTicketsByKind('change');
  const cab = changes.filter(awaitingCab);

  return (
    <div className="v2-cal">
      {/* Header */}
      <div className="v2-cal-head">
        <div>
          <div className="v2-eyebrow">Operations · Delivery</div>
          <h1 className="v2-h1">Change management</h1>
          <div className="v2-sub">Scheduled changes, maintenance windows, approvals</div>
        </div>
        <span className={`v2-pill ${live ? 'ok' : 'info'}`}>{live ? 'Live' : 'Mock'}</span>
      </div>

      {/* CAB queue — awaiting approval */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>CAB queue · awaiting approval</h3>
          <span className="v2-link">{cab.length} pending</span>
        </div>

        {cab.length === 0 ? (
          <div style={{ padding: '28px 16px', color: 'var(--muted)', fontSize: 13 }}>
            No changes are awaiting CAB approval. Change records raised across the estate
            appear here while they wait for review.
          </div>
        ) : (
          cab.map((row) => {
            const risk = riskOf(row);
            return (
              <div className="v2-cal-cab-row" key={row.ref}>
                <div>
                  <div className="v2-cal-cab-ref">{row.ref}</div>
                  <div className="v2-cal-cab-title">{row.title}</div>
                  <div className="v2-cal-cab-meta">
                    <span className={`v2-pill ${risk.tone}`}>{risk.label}</span>
                    <span className="dot" />
                    <span>{requesterOf(row)}</span>
                    <span className="dot" />
                    <span>{windowOf(row)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* All change records */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Change records</h3>
          <span className="v2-link">{changes.length} total</span>
        </div>

        {changes.length === 0 ? (
          <div style={{ padding: '28px 16px', color: 'var(--muted)', fontSize: 13 }}>
            No change records yet. Changes raised from findings, releases or manually
            appear here with their schedule and approval status.
          </div>
        ) : (
          changes.map((row) => {
            const risk = riskOf(row);
            return (
              <div className="v2-cal-cab-row" key={row.ref}>
                <div>
                  <div className="v2-cal-cab-ref">{row.ref}</div>
                  <div className="v2-cal-cab-title">{row.title}</div>
                  <div className="v2-cal-cab-meta">
                    <span className={`v2-pill ${risk.tone}`}>{risk.label}</span>
                    <span className="dot" />
                    <span>{String(row.status).replace(/_/g, ' ')}</span>
                    <span className="dot" />
                    <span>{windowOf(row)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
