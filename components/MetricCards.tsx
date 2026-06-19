import type { ServiceTicket, TicketKind } from '@/lib/mock';

// Small dashboard stat cards for a section header. Presentational — pass it the
// already-derived metrics. Reuses the `.card .k/.v` primitives so it matches the
// dashboard tiles elsewhere in the app.
export type Metric = { label: string; value: number | string; hint?: string };

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid grid-4 mb">
      {metrics.map((m) => (
        <div key={m.label} className="card">
          <div className="k">{m.label}</div>
          <div className="v">{m.value}</div>
          {m.hint && <div className="sub">{m.hint}</div>}
        </div>
      ))}
    </div>
  );
}

const OPEN_STATUSES = new Set([
  'open', 'in_progress', 'investigating', 'awaiting_cab', 'building',
  'planned', 'scheduled', 'staged', 'draft',
]);

// SLA-risk = has an SLA due date inside the next 24h (or already overdue) and the
// record isn't in a terminal state.
function slaAtRisk(t: ServiceTicket): boolean {
  if (!t.slaDue) return false;
  if (!OPEN_STATUSES.has(t.status)) return false;
  const due = new Date(t.slaDue).getTime();
  if (isNaN(due)) return false;
  return due - Date.now() < 24 * 3600 * 1000;
}

function startOfWeek(d: Date): number {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// Derive the section dashboard metrics from the section's own tickets. No DB
// call — operates on the rows the page already loaded.
export function sectionMetrics(kind: TicketKind, tickets: ServiceTicket[]): Metric[] {
  const open = tickets.filter((t) => OPEN_STATUSES.has(t.status)).length;
  const slaRisk = tickets.filter(slaAtRisk).length;
  const metrics: Metric[] = [
    { label: 'Open', value: open },
    { label: 'SLA at risk', value: slaRisk, hint: 'due within 24h' },
  ];

  if (kind === 'change') {
    const awaitingCab = tickets.filter(
      (t) => t.status === 'awaiting_cab' || (t.attrs?.cab_status ?? '') === 'pending'
    ).length;
    metrics.push({ label: 'Awaiting CAB', value: awaitingCab });
  } else if (kind === 'release') {
    const weekStart = startOfWeek(new Date());
    const weekEnd = weekStart + 7 * 24 * 3600 * 1000;
    const thisWeek = tickets.filter((t) => {
      const w = t.attrs?.window;
      if (typeof w !== 'string') return false;
      const m = w.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return false;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      return d >= weekStart && d < weekEnd;
    }).length;
    metrics.push({ label: 'Releases this week', value: thisWeek });
  } else {
    metrics.push({ label: 'Total', value: tickets.length });
  }

  return metrics;
}
