// Shared contract for the v2 JSON API (Overview + Support desk). Types only —
// no runtime code. The route handlers under app/api/v2/* produce these shapes;
// the v2 client pages consume them. Fields sourced from lib/data are "real";
// several presentational fields are deterministically DECORATED placeholders
// until a customer-support / SLA / infra model exists (see route comments).

export type OverviewKpi = { value: string; meta: string };

export type AttentionItem = {
  key: string; tint: string; title: string;
  src: 'security' | 'ops' | 'support'; srcLabel: string; ref: string;
  pill: string; pillLabel: string; age: string; href: string;
};

export type PostureBar = { lab: string; pct: number; color: string };

export type SupportQueue = { name: string; pill: string; pillLabel: string; count: number };

export type OverviewData = {
  live: boolean;
  kpis: { incidents: OverviewKpi; findings: OverviewKpi; sla: OverviewKpi; services: OverviewKpi };
  attention: AttentionItem[];
  posture: { score: number; bars: PostureBar[] };
  queues: SupportQueue[];
};

export type SupportTicketRow = {
  ref: string; title: string; customer: string; plan: string;
  priority: string; priorityPill: string; status: string;
  sla: string; slaState: 'ok' | 'warn' | 'breach'; owner: string; linked?: string;
};

export type SupportData = { live: boolean; tickets: SupportTicketRow[] };
