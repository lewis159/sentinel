'use client';

import { useEffect, useState } from 'react';

// Recent log tail from Loki (via the Clerk-gated /api/metrics/logs, which runs
// the LogQL query_range server-side). Shows the most recent ~25 lines (newest
// first) with level colouring. Graceful "unreachable" / "no logs" states. The
// underlying LogQL selector is broad and tunable (see lib/loki.ts). Themed with
// CSS vars.

type Level = 'error' | 'warn' | 'info' | 'debug' | 'other';
type LogLine = { ts: number; level: Level; line: string; stream?: string };

const levelColor: Record<Level, string> = {
  error: 'var(--crit)',
  warn: 'var(--high)',
  info: 'var(--low)',
  debug: 'var(--muted)',
  other: 'var(--faint)',
};

function fmtTime(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function LogTailWidget() {
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/metrics/logs', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (!d?.ok) { setNote(d?.note); setState('down'); return; }
          setLines(Array.isArray(d.lines) ? d.lines : []);
          setState('ok');
        })
        .catch(() => { if (!cancelled) { setNote('unreachable'); setState('down'); } });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (state === 'loading') return <div className="mon-state">Loading logs…</div>;
  if (state === 'down') return <div className="mon-state">Loki {note ?? 'unreachable'}</div>;
  if (!lines || lines.length === 0) return <div className="mon-state">No recent log lines</div>;

  return (
    <div className="mon-logs">
      {lines.map((l, i) => (
        <div key={`${l.ts}-${i}`} className="mon-log-row">
          <span className="mon-log-time">{fmtTime(l.ts)}</span>
          <span className="mon-log-level" style={{ color: levelColor[l.level] }}>{l.level}</span>
          {l.stream ? <span className="mon-log-stream" title={l.stream}>{l.stream}</span> : null}
          <span className="mon-log-msg" title={l.line}>{l.line}</span>
        </div>
      ))}
    </div>
  );
}
