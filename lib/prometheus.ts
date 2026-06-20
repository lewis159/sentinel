// Server-only. Read-only Prometheus HTTP API client.
//
// Base URL from PROMETHEUS_URL (default the in-stack service name). Prometheus
// has no auth internally. Two queries are exposed: an instant query
// (/api/v1/query) and a range query (/api/v1/query_range). Both have a ~4s
// timeout and resolve to `null` on ANY failure (unreachable, non-2xx, parse
// error, status!=success) so widgets render an "unreachable" state rather than
// crashing the page. Dependency-free (global fetch + AbortController).

const BASE = (process.env.PROMETHEUS_URL || 'http://yt-monitoring_prometheus:9090').replace(/\/$/, '');
const TIMEOUT_MS = 4000;

// Prometheus result shapes we care about. A "vector" result is an array of
// { metric, value: [ts, "val"] }; a "matrix" is { metric, values: [[ts,"val"]] }.
export type PromSample = { metric: Record<string, string>; value: number; ts: number };
export type PromSeries = { metric: Record<string, string>; points: { ts: number; value: number }[] };

async function fetchJson(path: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.status !== 'success') return null;
    return json.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Instant query → vector samples (current value per series). null on failure.
export async function promQuery(expr: string): Promise<PromSample[] | null> {
  const data = await fetchJson(`/api/v1/query?query=${encodeURIComponent(expr)}`);
  if (!data || !Array.isArray(data.result)) return null;
  const out: PromSample[] = [];
  for (const r of data.result) {
    const v = r?.value;
    if (!Array.isArray(v) || v.length < 2) continue;
    const num = Number(v[1]);
    if (!Number.isFinite(num)) continue;
    out.push({ metric: r.metric ?? {}, value: num, ts: Number(v[0]) || 0 });
  }
  return out;
}

// Range query → matrix series (a point per step over the window). `stepMins` is
// the resolution; `rangeMins` is how far back from now. null on failure.
export async function promRange(expr: string, stepMins = 1, rangeMins = 30): Promise<PromSeries[] | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeMins * 60;
  const step = Math.max(1, Math.round(stepMins * 60)); // seconds
  const qs = `query=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${step}`;
  const data = await fetchJson(`/api/v1/query_range?${qs}`);
  if (!data || !Array.isArray(data.result)) return null;
  const out: PromSeries[] = [];
  for (const r of data.result) {
    const values = Array.isArray(r?.values) ? r.values : [];
    const points = values
      .map((p: any) => ({ ts: Number(p?.[0]) || 0, value: Number(p?.[1]) }))
      .filter((p: { value: number }) => Number.isFinite(p.value));
    out.push({ metric: r.metric ?? {}, points });
  }
  return out;
}

export const prometheusBase = BASE;
