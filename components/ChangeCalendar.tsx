'use client';

import { useMemo, useState } from 'react';
import { type ServiceTicket } from '@/lib/mock';

// Change calendar: month / week grid of SCHEDULED changes (kind=change with a
// parseable date in attrs.window), colored by risk. Changes whose window isn't
// a concrete date (TBD / Q3 / immediate / empty) are listed as "unscheduled".

type RiskKey = 'high' | 'medium' | 'low';

const RISK_STYLE: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  high:   { bg: 'rgba(229,72,77,.16)', fg: '#ff8b8e', dot: '#e5484d', label: 'High risk' },
  medium: { bg: 'rgba(245,165,36,.16)', fg: '#ffc05a', dot: '#f5a524', label: 'Medium risk' },
  low:    { bg: 'rgba(51,184,122,.16)', fg: '#5fd49b', dot: '#33b87a', label: 'Low risk' },
};
function riskStyle(risk: string) {
  return RISK_STYLE[risk] ?? { bg: '#222838', fg: 'var(--muted)', dot: '#8A93A6', label: risk || 'Unspecified' };
}

// Parse a leading YYYY-MM-DD out of an attrs.window string. Returns a local
// Date at midnight, or null if the window isn't a concrete date.
function parseWindow(window_: unknown): Date | null {
  if (typeof window_ !== 'string') return null;
  const m = window_.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function ChangeCalendar({ changes }: { changes: ServiceTicket[] }) {
  const [mode, setMode] = useState<'month' | 'week'>('month');
  // Anchor on the first scheduled change if there is one, else today.
  const firstScheduled = useMemo(() => {
    for (const c of changes) {
      const d = parseWindow(c.attrs?.window);
      if (d) return d;
    }
    return new Date();
  }, [changes]);
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date(firstScheduled);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Index scheduled changes by YYYY-MM-DD; collect the unscheduled ones.
  const { byDay, unscheduled } = useMemo(() => {
    const map = new Map<string, ServiceTicket[]>();
    const un: ServiceTicket[] = [];
    for (const c of changes) {
      const d = parseWindow(c.attrs?.window);
      if (!d) { un.push(c); continue; }
      const k = ymd(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return { byDay: map, unscheduled: un };
  }, [changes]);

  // Build the visible day cells.
  const days = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start); d.setDate(start.getDate() + i); return d;
      });
    }
    // month: pad to whole weeks starting Monday.
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const gridEnd = startOfWeek(last);
    gridEnd.setDate(gridEnd.getDate() + 7);
    const out: Date[] = [];
    for (let d = new Date(gridStart); d < gridEnd; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [cursor, mode]);

  function shift(dir: -1 | 1) {
    const d = new Date(cursor);
    if (mode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  }

  const todayKey = ymd(new Date());
  const heading = mode === 'week'
    ? `Week of ${startOfWeek(cursor).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="card mb">
      <div className="panel-h">
        <div className="row" style={{ gap: 10 }}>
          <h3>Change calendar</h3>
          <div className="row" style={{ gap: 6 }}>
            <button className={`chip ${mode === 'month' ? 'on' : ''}`} onClick={() => setMode('month')}>Month</button>
            <button className={`chip ${mode === 'week' ? 'on' : ''}`} onClick={() => setMode('week')}>Week</button>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm ghost" onClick={() => shift(-1)}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>{heading}</span>
          <button className="btn sm ghost" onClick={() => shift(1)}>›</button>
        </div>
      </div>

      {/* Risk legend */}
      <div className="row" style={{ gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['high', 'medium', 'low'] as RiskKey[]).map((r) => (
          <span key={r} className="sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: RISK_STYLE[r].dot, display: 'inline-block' }} />
            {RISK_STYLE[r].label}
          </span>
        ))}
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {days.map((d) => {
          const k = ymd(d);
          const items = byDay.get(k) ?? [];
          const inMonth = mode === 'week' || d.getMonth() === cursor.getMonth();
          return (
            <div key={k} className="cal-cell" data-dim={!inMonth} data-today={k === todayKey}>
              <div className="cal-date">{d.getDate()}</div>
              {items.map((c) => {
                const s = riskStyle(String(c.attrs?.risk ?? ''));
                return (
                  <div key={c.ref} className="cal-event" style={{ background: s.bg, color: s.fg }}
                    title={`${c.ref} · ${c.title} · risk ${c.attrs?.risk ?? '—'}`}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: s.dot, display: 'inline-block', flexShrink: 0 }} />
                    <span className="cal-event-t">{c.title}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {unscheduled.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="sub" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px', fontSize: 11, fontWeight: 600 }}>
            Unscheduled ({unscheduled.length})
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {unscheduled.map((c) => {
              const s = riskStyle(String(c.attrs?.risk ?? ''));
              const win = c.attrs?.window ? String(c.attrs.window) : 'no window';
              return (
                <span key={c.ref} className="tag" style={{ background: s.bg, color: s.fg }}
                  title={`${c.ref} · ${c.title}`}>
                  <span className="mono" style={{ fontSize: 10 }}>{c.ref}</span>
                  <span style={{ opacity: .85 }}>{win}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
