// Server-only. Read-only Alertmanager v2 API client.
//
// Base URL from ALERTMANAGER_URL (default the in-stack service name).
// Alertmanager has no auth internally. We fetch the active alerts via
// GET /api/v2/alerts?active=true and reduce them to a compact list grouped by
// severity (read off the conventional `severity` label).
//
// State contract: returns { ok, alerts, groups, note? }. `ok` is false (with a
// clear note) when Alertmanager is unreachable / errors — the widget renders an
// "unreachable" state rather than crashing. Dependency-free (global fetch +
// AbortController).

const BASE = (process.env.ALERTMANAGER_URL || 'http://yt-monitoring_alertmanager:9093').replace(/\/$/, '');
const TIMEOUT_MS = 4000;

// Known severities in display order; anything else lands in "other".
export const ALERT_SEVERITIES = ['critical', 'warning', 'info', 'other'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type ActiveAlert = {
  name: string;
  severity: AlertSeverity;
  summary: string;
  startsAt: string;
};
export type AlertStatus = {
  ok: boolean;
  alerts: ActiveAlert[];
  groups: Record<AlertSeverity, number>;
  note?: string;
};

function normSeverity(raw: unknown): AlertSeverity {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'critical' || s === 'crit' || s === 'page') return 'critical';
  if (s === 'warning' || s === 'warn') return 'warning';
  if (s === 'info' || s === 'information' || s === 'none') return 'info';
  return 'other';
}

function emptyGroups(): Record<AlertSeverity, number> {
  return { critical: 0, warning: 0, info: 0, other: 0 };
}

export async function getActiveAlerts(): Promise<AlertStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // active=true → firing alerts only; silenced/inhibited excluded.
    const res = await fetch(`${BASE}/api/v2/alerts?active=true&silenced=false&inhibited=false`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, alerts: [], groups: emptyGroups(), note: `Alertmanager ${res.status}` };
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      return { ok: false, alerts: [], groups: emptyGroups(), note: 'unexpected response' };
    }
    const groups = emptyGroups();
    const alerts: ActiveAlert[] = [];
    for (const a of body) {
      const labels = (a?.labels ?? {}) as Record<string, string>;
      const annotations = (a?.annotations ?? {}) as Record<string, string>;
      const severity = normSeverity(labels.severity);
      groups[severity] += 1;
      alerts.push({
        name: labels.alertname || annotations.summary || 'alert',
        severity,
        summary: annotations.summary || annotations.description || labels.alertname || '',
        startsAt: String(a?.startsAt ?? ''),
      });
    }
    // Sort most-severe first, then by name.
    const order = (s: AlertSeverity) => ALERT_SEVERITIES.indexOf(s);
    alerts.sort((x, y) => order(x.severity) - order(y.severity) || x.name.localeCompare(y.name));
    return { ok: true, alerts, groups };
  } catch {
    return { ok: false, alerts: [], groups: emptyGroups(), note: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export const alertmanagerBase = BASE;
