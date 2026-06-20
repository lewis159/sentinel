// Server-only. Read-only Grafana Loki query client.
//
// Base URL from LOKI_URL (default the in-stack service name). We run a
// query_range against a broad default LogQL selector and return the most recent
// ~N lines (newest first) with a best-effort log level parsed from each line.
//
// NOTE: Loki's label schema is deployment-specific and unknown here, so the
// default selector `{job=~".+"}` matches any stream that carries a `job` label
// (the convention most scrape configs use). If the live deployment labels
// streams differently, set LOKI_QUERY to a selector that matches — e.g.
// `{container=~".+"}` or `{compose_service=~".+"}`. Keep it a valid stream
// selector (at least one matcher).
//
// State contract: returns { ok, lines, note? }. `ok` is false (with a clear
// note) when Loki is unreachable / errors. Dependency-free (global fetch +
// AbortController).

const BASE = (process.env.LOKI_URL || 'http://yt-monitoring_loki:3100').replace(/\/$/, '');
// Broad, tunable default. Override with LOKI_QUERY for the live label schema.
const QUERY = process.env.LOKI_QUERY || '{job=~".+"}';
const TIMEOUT_MS = 4000;
const DEFAULT_LIMIT = 25;

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'other';
export type LogLine = { ts: number; level: LogLevel; line: string; stream?: string };
export type LogStatus = { ok: boolean; lines: LogLine[]; query: string; note?: string };

// Best-effort level detection from a raw log line.
function detectLevel(line: string): LogLevel {
  const s = line.toLowerCase();
  if (/\b(error|err|fatal|panic|exception)\b/.test(s)) return 'error';
  if (/\b(warn|warning)\b/.test(s)) return 'warn';
  if (/\b(info|notice)\b/.test(s)) return 'info';
  if (/\b(debug|trace)\b/.test(s)) return 'debug';
  return 'other';
}

// Compact stream label set into a short hint (e.g. job/container name).
function streamHint(stream: Record<string, string> | undefined): string | undefined {
  if (!stream) return undefined;
  return stream.container || stream.compose_service || stream.job || stream.app || stream.unit || undefined;
}

export async function getRecentLogs(limit = DEFAULT_LIMIT): Promise<LogStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const end = Date.now() * 1e6; // ns
    const start = (Date.now() - 60 * 60 * 1000) * 1e6; // last hour, ns
    const qs =
      `query=${encodeURIComponent(QUERY)}` +
      `&start=${start}&end=${end}&limit=${limit}&direction=backward`;
    const res = await fetch(`${BASE}/loki/api/v1/query_range?${qs}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, lines: [], query: QUERY, note: `Loki ${res.status}` };
    }
    const body = await res.json();
    if (body?.status !== 'success' || !body?.data?.result) {
      return { ok: false, lines: [], query: QUERY, note: 'unexpected response' };
    }
    const result = body.data.result as Array<{ stream?: Record<string, string>; values?: [string, string][] }>;
    const lines: LogLine[] = [];
    for (const series of result) {
      const hint = streamHint(series.stream);
      for (const [tsNs, line] of series.values ?? []) {
        lines.push({
          ts: Math.floor(Number(tsNs) / 1e6), // ns → ms
          level: detectLevel(line),
          line,
          stream: hint,
        });
      }
    }
    // Newest first, capped at the requested limit (results may be multi-stream).
    lines.sort((a, b) => b.ts - a.ts);
    return { ok: true, lines: lines.slice(0, limit), query: QUERY };
  } catch {
    return { ok: false, lines: [], query: QUERY, note: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export const lokiBase = BASE;
