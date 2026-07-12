// Server-only. Overall SERVICE STATUS signal for the public support surfaces.
//
// The public support-chat widget shows a coarse "operational / degraded / down"
// dot. This helper resolves that signal from the estate's REAL monitoring, by
// reusing the existing read-only clients (no new monitoring wiring is invented):
//
//   1. Alertmanager (lib/alertmanager) — PRIMARY. Active alerts are the cleanest
//      "is something wrong right now" signal. A firing `critical` alert →
//      'down'; a firing `warning` (no critical) → 'degraded'; otherwise
//      'operational'.
//   2. Uptime-Kuma  (lib/uptime)       — FALLBACK, used only when Alertmanager is
//      unreachable/unconfigured. Any monitor not `up` → 'degraded' (all down →
//      'down'); all up → 'operational'.
//
// Safety contract (the widget must NEVER break):
//   - Both underlying clients already catch everything and return an `ok:false`
//     state instead of throwing, so this helper cannot throw either.
//   - If NEITHER source is reachable/configured, we return 'operational' with
//     `source:'default'` — a missing monitoring stack must not paint the public
//     widget red.
//
// The result is cached briefly (SUPPORT_STATUS_CACHE_MS, default 45s) so a busy
// widget can't hammer Alertmanager/Kuma.

import { getActiveAlerts } from '@/lib/alertmanager';
import { getUptimeStatus } from '@/lib/uptime';

export type OverallStatus = 'operational' | 'degraded' | 'down';
export type StatusSource = 'alertmanager' | 'uptime-kuma' | 'default';
export type StatusComponent = { name: string; status: OverallStatus };

export type SupportStatus = {
  status: OverallStatus;
  source: StatusSource;
  components: StatusComponent[];
  note?: string;
};

const num = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

// Cache TTL — read at call time so a test/env can tune it.
function cacheMs(): number {
  return num(process.env.SUPPORT_STATUS_CACHE_MS, 45_000);
}

let cache: { at: number; value: SupportStatus } | null = null;

// Reset the in-memory cache. Exported for tests only.
export function __resetSupportStatusCache(): void {
  cache = null;
}

// Compute the status fresh from the monitoring sources (no cache). Exported so
// tests can exercise the mapping deterministically.
export async function computeSupportStatus(): Promise<SupportStatus> {
  // ---- Primary: Alertmanager active alerts ----
  const alerts = await getActiveAlerts();
  if (alerts.ok) {
    const status: OverallStatus =
      alerts.groups.critical > 0 ? 'down' : alerts.groups.warning > 0 ? 'degraded' : 'operational';
    // Surface the firing critical/warning alerts as components (bounded).
    const components: StatusComponent[] = alerts.alerts
      .filter((a) => a.severity === 'critical' || a.severity === 'warning')
      .slice(0, 10)
      .map((a) => ({ name: a.name, status: a.severity === 'critical' ? 'down' : 'degraded' }));
    return { status, source: 'alertmanager', components };
  }

  // ---- Fallback: Uptime-Kuma heartbeats ----
  const uptime = await getUptimeStatus();
  if (uptime.ok) {
    const down = uptime.monitors.filter((m) => !m.up);
    const status: OverallStatus =
      down.length === 0
        ? 'operational'
        : uptime.monitors.length > 0 && down.length >= uptime.monitors.length
          ? 'down'
          : 'degraded';
    const components: StatusComponent[] = uptime.monitors
      .slice(0, 20)
      .map((m) => ({ name: m.name, status: m.up ? 'operational' : 'down' }));
    return { status, source: 'uptime-kuma', components };
  }

  // ---- Neither source reachable/configured → safe default ----
  // A missing monitoring stack must never paint the public widget red.
  return {
    status: 'operational',
    source: 'default',
    components: [],
    note: alerts.note ?? uptime.note,
  };
}

// Cached entry point used by the routes.
export async function getSupportStatus(): Promise<SupportStatus> {
  const now = Date.now();
  if (cache && now - cache.at < cacheMs()) return cache.value;
  const value = await computeSupportStatus();
  cache = { at: now, value };
  return value;
}
