// Server-only. Uptime Kuma status via its Prometheus-exposition `/metrics`
// endpoint.
//
// Kuma has no clean REST API, but it exposes /metrics (Prometheus text format)
// guarded by HTTP Basic auth: username EMPTY, password = the API key you create
// under Settings → API Keys. We parse the `monitor_status{...}` gauge lines into
// a simple { name, up }[]. monitor_status values: 1 = up, 0 = down, 2 = pending,
// 3 = maintenance. We treat 1 as up, everything else as not-up.
//
// State contract: returns { monitors, ok, note }. `ok` is false (with a clear
// note) when the key is missing or Kuma is unreachable — the widget shows a
// "not configured / unreachable" state rather than crashing.

const BASE = (process.env.UPTIME_KUMA_URL || 'http://yt-monitoring_uptime-kuma:3001').replace(/\/$/, '');
const API_KEY = process.env.UPTIME_KUMA_API_KEY || '';
const TIMEOUT_MS = 4000;

export type UptimeMonitor = { name: string; up: boolean; status: number };
export type UptimeStatus = { monitors: UptimeMonitor[]; ok: boolean; note?: string };

// Parse Kuma's /metrics body for monitor_status lines, e.g.:
//   monitor_status{monitor_name="YT app",monitor_type="http",...} 1
function parseMetrics(body: string): UptimeMonitor[] {
  const out: UptimeMonitor[] = [];
  const re = /^monitor_status\{([^}]*)\}\s+([0-9.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const labels = m[1];
    const status = Number(m[2]);
    const nameMatch = /monitor_name="((?:[^"\\]|\\.)*)"/.exec(labels);
    const name = nameMatch ? nameMatch[1].replace(/\\"/g, '"') : 'unknown';
    out.push({ name, up: status === 1, status });
  }
  return out;
}

export async function getUptimeStatus(): Promise<UptimeStatus> {
  if (!API_KEY) {
    return { monitors: [], ok: false, note: 'not configured (set UPTIME_KUMA_API_KEY)' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // HTTP Basic: empty username, password = API key.
    const authHeader = 'Basic ' + Buffer.from(`:${API_KEY}`).toString('base64');
    const res = await fetch(`${BASE}/metrics`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Authorization: authHeader },
    });
    if (res.status === 401 || res.status === 403) {
      return { monitors: [], ok: false, note: 'auth rejected (check API key)' };
    }
    if (!res.ok) {
      return { monitors: [], ok: false, note: `Kuma /metrics ${res.status}` };
    }
    const body = await res.text();
    const monitors = parseMetrics(body).sort((a, b) => a.name.localeCompare(b.name));
    return { monitors, ok: true };
  } catch {
    return { monitors: [], ok: false, note: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export const uptimeBase = BASE;
