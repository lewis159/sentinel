'use client';

import { useEffect, useState } from 'react';

// Active alerts from Alertmanager (via the Clerk-gated /api/metrics/alerts,
// which reads Alertmanager's v2 API server-side). Shows per-severity counts +
// a compact list of firing alerts. Graceful "unreachable" / "no alerts" states.
// Themed with CSS vars.

type Severity = 'critical' | 'warning' | 'info' | 'other';
type Alert = { name: string; severity: Severity; summary: string; startsAt: string };
type Groups = Record<Severity, number>;

const SEV_ORDER: Severity[] = ['critical', 'warning', 'info', 'other'];
const sevColor: Record<Severity, string> = {
  critical: 'var(--crit)',
  warning: 'var(--high)',
  info: 'var(--low)',
  other: 'var(--muted)',
};

export function AlertsWidget() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/alerts', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok) { setNote(d?.note); setState('down'); return; }
          setAlerts(Array.isArray(d.alerts) ? d.alerts : []);
          setGroups(d.groups ?? null);
          setState('ok');
        })
        .catch(() => { if (!cancelled) { setNote('unreachable'); setState('down'); } });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (state === 'loading') return <div className="mon-state">Loading alerts…</div>;
  if (state === 'down') return <div className="mon-state">Alertmanager {note ?? 'unreachable'}</div>;
  if (!alerts || alerts.length === 0) return <div className="mon-state">No active alerts 🎉</div>;

  return (
    <div className="mon-alerts">
      <div className="mon-alerts-sum">
        {SEV_ORDER.filter((s) => (groups?.[s] ?? 0) > 0).map((s) => (
          <span key={s} className="mon-alerts-pill" style={{ borderColor: sevColor[s], color: sevColor[s] }}>
            <span className="mon-dot" style={{ background: sevColor[s] }} aria-hidden />
            {groups?.[s] ?? 0} {s}
          </span>
        ))}
      </div>
      <ul className="mon-alerts-list">
        {alerts.map((a, i) => (
          <li key={`${a.name}-${i}`} className="mon-alerts-row">
            <span className="mon-dot" style={{ background: sevColor[a.severity] }} aria-hidden />
            <span className="mon-alerts-name">{a.name}</span>
            <span className="mon-alerts-summary" title={a.summary}>{a.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
