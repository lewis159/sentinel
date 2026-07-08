import './signals.css';
import { requireSectionPage } from '@/lib/auth';
import { getAlerts, type Alert } from '@/lib/data';
import type { Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Alerts. Firing/acknowledged/resolved signals from ops.alerts
// (getAlerts falls back to mock when there's no DB). Renders inside the v2 shell
// (.v2-shell > .v2-content); this file supplies page content only. Shared
// `v2-sig-*` styling lives in ./signals.css (also imported by the Activity page).

const SEV_LABEL: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
};

// Normalise a status string to one of the styled chip variants.
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'firing') return 'firing';
  if (s === 'acknowledged' || s === 'ack') return 'acknowledged';
  if (s === 'resolved' || s === 'closed') return 'resolved';
  return '';
}

export default async function V2AlertsPage() {
  await requireSectionPage('operations');

  const { rows } = await getAlerts();
  const firing = rows.filter((a) => a.status?.toLowerCase() === 'firing').length;

  return (
    <div>
      {/* Header */}
      <div className="v2-sig-head">
        <div className="v2-eyebrow">Operations · Signals</div>
        <h1 className="v2-h1">Alerts</h1>
        <div className="v2-sub">{firing} firing</div>
      </div>

      {/* Alerts list */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Signals</h3>
          <span className="v2-link">{rows.length} total</span>
        </div>

        {rows.length === 0 ? (
          <div className="v2-sig-empty">
            <div className="ic">✓</div>
            <div className="t">No active alerts</div>
            <div className="d">Everything is quiet — no rules are firing right now.</div>
          </div>
        ) : (
          <div className="v2-sig-list">
            {rows.map((a: Alert) => (
              <div className="v2-sig-row" key={a.id}>
                <span className={`v2-sig-pill ${a.severity}`}>{SEV_LABEL[a.severity] ?? a.severity}</span>
                <div className="v2-sig-main">
                  <div className="v2-sig-msg">{a.message}</div>
                  <div className="v2-sig-rule">{a.rule}</div>
                </div>
                <span className={`v2-sig-status ${statusClass(a.status)}`}>{a.status}</span>
                <span className="v2-sig-when">{a.when}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
