'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServiceTicket, TicketKind } from '@/lib/mock';

// ---------- Metric registry ----------
// Each metric knows how to compute itself client-side from the section's own
// tickets. `appliesTo` (when set) restricts a metric to specific kinds.
export type MetricDef = {
  id: string;
  label: string;
  hint?: string;
  appliesTo?: TicketKind[];
  compute: (tickets: ServiceTicket[], kind: TicketKind) => number;
};

const OPEN_STATUSES = new Set([
  'open', 'in_progress', 'investigating', 'awaiting_cab', 'building',
  'planned', 'scheduled', 'staged', 'draft',
]);
const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'done', 'fulfilled', 'deployed', 'verified', 'implemented']);

function notClosed(t: ServiceTicket): boolean {
  return !TERMINAL_STATUSES.has(t.status);
}

function unassigned(t: ServiceTicket): boolean {
  const a = (t.assignee ?? '').trim();
  return a === '' || a === '—';
}

function slaAtRisk(t: ServiceTicket): boolean {
  if (!t.slaDue || !notClosed(t)) return false;
  const due = new Date(t.slaDue).getTime();
  if (isNaN(due)) return false;
  const delta = due - Date.now();
  return delta >= 0 && delta < 24 * 3600 * 1000;
}

function slaBreached(t: ServiceTicket): boolean {
  if (!t.slaDue || !notClosed(t)) return false;
  const due = new Date(t.slaDue).getTime();
  if (isNaN(due)) return false;
  return due < Date.now();
}

function startOfWeek(d: Date): number {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// Best-effort "created this week" using the relative `age` string the row carries
// (e.g. "2h", "3d"). Anything measured in minutes/hours, or < 7 days, counts.
function createdThisWeek(t: ServiceTicket): boolean {
  const age = (t.age ?? '').trim();
  if (!age || age === '—') return false;
  if (age === 'just now') return true;
  const m = age.match(/^(\d+)\s*([mhd])$/);
  if (!m) return false;
  const n = Number(m[1]);
  if (m[2] === 'd') return n < 7;
  return true; // minutes or hours → within the week
}

function windowThisWeek(t: ServiceTicket): boolean {
  const w = t.attrs?.window;
  if (typeof w !== 'string') return false;
  const m = w.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const start = startOfWeek(new Date());
  return d >= start && d < start + 7 * 24 * 3600 * 1000;
}

export const METRIC_REGISTRY: MetricDef[] = [
  { id: 'total', label: 'Total', compute: (ts) => ts.length },
  { id: 'open', label: 'Open', compute: (ts) => ts.filter((t) => OPEN_STATUSES.has(t.status)).length },
  { id: 'in_progress', label: 'In progress', compute: (ts) => ts.filter((t) => t.status === 'in_progress').length },
  { id: 'unassigned', label: 'Unassigned', compute: (ts) => ts.filter(unassigned).length },
  { id: 'sla_at_risk', label: 'SLA at risk', hint: 'due within 24h', compute: (ts) => ts.filter(slaAtRisk).length },
  { id: 'sla_breached', label: 'SLA breached', hint: 'past due, not closed', compute: (ts) => ts.filter(slaBreached).length },
  { id: 'high_priority', label: 'High priority', compute: (ts) => ts.filter((t) => t.priority === 'high' || t.priority === 'critical').length },
  { id: 'resolved', label: 'Resolved', compute: (ts) => ts.filter((t) => TERMINAL_STATUSES.has(t.status)).length },
  { id: 'created_this_week', label: 'Created this week', compute: (ts) => ts.filter(createdThisWeek).length },
  {
    id: 'awaiting_cab', label: 'Awaiting CAB', appliesTo: ['change'],
    compute: (ts) => ts.filter((t) => t.status === 'awaiting_cab' || (t.attrs?.cab_status ?? '') === 'pending').length,
  },
  {
    id: 'releasing_this_week', label: 'Releasing this week', appliesTo: ['release'],
    compute: (ts) => ts.filter(windowThisWeek).length,
  },
];

const REGISTRY_BY_ID = new Map(METRIC_REGISTRY.map((m) => [m.id, m]));

// Per-kind default 4-card selection.
const DEFAULTS: Record<TicketKind, string[]> = {
  incident: ['open', 'sla_at_risk', 'unassigned', 'total'],
  request:  ['open', 'sla_at_risk', 'unassigned', 'total'],
  change:   ['open', 'awaiting_cab', 'sla_at_risk', 'total'],
  problem:  ['open', 'sla_at_risk', 'unassigned', 'total'],
  release:  ['open', 'releasing_this_week', 'sla_at_risk', 'total'],
};

function metricsForKind(kind: TicketKind): MetricDef[] {
  return METRIC_REGISTRY.filter((m) => !m.appliesTo || m.appliesTo.includes(kind));
}

function defaultSelection(kind: TicketKind): string[] {
  const want = DEFAULTS[kind] ?? DEFAULTS.incident;
  const applicable = new Set(metricsForKind(kind).map((m) => m.id));
  const sel = want.filter((id) => applicable.has(id));
  // Pad to exactly 4 with any remaining applicable metrics.
  for (const m of metricsForKind(kind)) {
    if (sel.length >= 4) break;
    if (!sel.includes(m.id)) sel.push(m.id);
  }
  return sel.slice(0, 4);
}

function sanitize(kind: TicketKind, ids: any): string[] {
  const applicable = new Set(metricsForKind(kind).map((m) => m.id));
  const sel: string[] = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && applicable.has(id)) : [];
  const def = defaultSelection(kind);
  for (const id of def) {
    if (sel.length >= 4) break;
    if (!sel.includes(id)) sel.push(id);
  }
  return sel.slice(0, 4);
}

// ---------- Component ----------
export function MetricCards({ kind, tickets }: { kind: TicketKind; tickets: ServiceTicket[] }) {
  const layoutKey = `metrics:${kind}`;
  const lsKey = `sentinel:layout:${layoutKey}`;
  const [selection, setSelection] = useState<string[]>(() => defaultSelection(kind));
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(lsKey);
      if (cached) setSelection(sanitize(kind, JSON.parse(cached)?.ids));
    } catch { /* ignore */ }

    fetch(`/api/layouts/${layoutKey}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout;
        if (saved && typeof saved === 'object' && Array.isArray(saved.ids)) {
          const next = sanitize(kind, saved.ids);
          setSelection(next);
          try { localStorage.setItem(lsKey, JSON.stringify({ ids: next })); } catch {}
        }
      })
      .catch(() => { /* keep cache/default */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persist = useCallback((ids: string[], immediate = false) => {
    const body = JSON.stringify({ ids });
    try { localStorage.setItem(lsKey, body); } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const put = () => {
      fetch(`/api/layouts/${layoutKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => { /* localStorage already holds it */ });
    };
    if (immediate) put();
    else saveTimer.current = setTimeout(put, 600);
  }, [lsKey, layoutKey]);

  const applicable = useMemo(() => metricsForKind(kind), [kind]);

  const changeCard = useCallback((idx: number, id: string) => {
    setSelection((prev) => {
      const next = [...prev];
      next[idx] = id;
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleEdit = useCallback(() => {
    setEditMode((on) => {
      if (on) persist(selection, true); // flush on leaving edit mode
      return !on;
    });
  }, [persist, selection]);

  const resetCards = useCallback(() => {
    const def = defaultSelection(kind);
    setSelection(def);
    persist(def);
  }, [kind, persist]);

  return (
    <div className="mb">
      <div className="row spread" style={{ marginBottom: 8 }}>
        <span className="sub">Section metrics{editMode ? ' — pick a metric per card' : ''}</span>
        <div className="row" style={{ gap: 8 }}>
          {editMode && <button className="btn ghost sm" onClick={resetCards}>Reset</button>}
          <button className={`btn sm${editMode ? '' : ' ghost'}`} onClick={toggleEdit} aria-pressed={editMode}>
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      <div className="grid grid-4">
        {selection.map((id, idx) => {
          const def = REGISTRY_BY_ID.get(id);
          const value = def && (!def.appliesTo || def.appliesTo.includes(kind))
            ? def.compute(tickets, kind)
            : 0;
          return (
            <div key={`${id}:${idx}`} className="card">
              {editMode ? (
                <select
                  className="select td-metric-select"
                  value={id}
                  onChange={(e) => changeCard(idx, e.target.value)}
                  aria-label={`Card ${idx + 1} metric`}
                >
                  {applicable.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <div className="k">{def?.label ?? id}</div>
              )}
              <div className="v">{value}</div>
              {!editMode && def?.hint && <div className="sub">{def.hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
