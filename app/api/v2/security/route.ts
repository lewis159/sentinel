// v2 Security API — GET /api/v2/security
// Returns the data for the v2 Security board. DB-first via lib/data with graceful
// fallbacks; every underlying call is wrapped so a source failure never 500s (it
// degrades to sensible values with live:false).
//
// REAL (from lib/data):
//   - kpis.critical / high / medium — open-finding counts by severity (getFindings)
//   - kpis.resolved30d — count of fixed findings (proxy; no true 30-day window)
//   - findings[] — top open findings mapped to the board shape (getFindings)
//   - scans[] — recent scan/worker runs (getScanRuns)
//   - live — OR of every source's live flag (getFindings/getScanRuns/getCheckStats)
// DECORATED PLACEHOLDERS (no source wired yet):
//   - coverage[] — the four scan-coverage bars (static percentages)
//   - posture.score — the overall posture score (static 78)
//
// Auth: Clerk global_admin via requireOpsAuth().

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getFindings, getScanRuns, getCheckStats } from '@/lib/data';
import type { Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// ---- Inline response contract (kept local to this route on purpose) ----
type SecKpis = { critical: number; high: number; medium: number; resolved30d: number };
type SecFinding = {
  ref: string; title: string; severity: Severity;
  component: string; cwe: string; pill: string;
};
type SecBar = { lab: string; pct: number; color: string };
type SecScan = { id: string; type: string; findings: string; when: string; pill: string };
type SecurityData = {
  live: boolean;
  kpis: SecKpis;
  findings: SecFinding[];
  coverage: SecBar[];
  scans: SecScan[];
  posture: { score: number };
};

const isOpen = (status?: string) => (status ?? '').toLowerCase() !== 'fixed';

// Finding severity → v2 pill variant. Only crit/high have dedicated accent pills;
// medium and below fall back to the neutral `info` pill.
function pillFor(sev: Severity): string {
  if (sev === 'critical') return 'crit';
  if (sev === 'high') return 'high';
  return 'info';
}

// Classify a scan run's outcome string into a pill variant.
function scanPill(run: { findings: string; status: string }): string {
  if (run.status === 'failed' || /fail/i.test(run.findings)) return 'crit';
  if (/critical/i.test(run.findings)) return 'crit';
  if (/^0\b/.test(run.findings)) return 'ok';
  return 'high';
}

// Wrap a fault-tolerant lib/data call so a source failure degrades to live:false.
async function safe<T>(
  fn: () => Promise<{ rows: T[]; live: boolean }>
): Promise<{ rows: T[]; live: boolean }> {
  try {
    return await fn();
  } catch {
    return { rows: [], live: false };
  }
}

export async function GET() {
  const denied = await requireSectionApi('security');
  if (denied) return denied;

  // Pull the three sources concurrently, each already fault-tolerant.
  const [findingsRes, scansRes, checksRes] = await Promise.all([
    safe(getFindings),
    safe(() => getScanRuns(20)),
    safe(getCheckStats),
  ]);

  const allFindings = findingsRes.rows;
  const scanRows = scansRes.rows;
  const live = findingsRes.live || scansRes.live || checksRes.live;

  // ---- KPIs (crit/high/medium real; resolved30d = fixed-count proxy) ----
  const open = allFindings.filter((f) => isOpen(f.status));
  const kpis: SecKpis = {
    critical: open.filter((f) => f.severity === 'critical').length,
    high: open.filter((f) => f.severity === 'high').length,
    medium: open.filter((f) => f.severity === 'medium').length,
    resolved30d: allFindings.filter((f) => !isOpen(f.status)).length,
  };

  // ---- Open findings (real; top 6 by cvss — getFindings already orders desc) ----
  const findings: SecFinding[] = open.slice(0, 6).map((f) => ({
    ref: f.ref,
    title: f.title,
    severity: f.severity,
    component: f.component,
    cwe: f.cwe ?? '',
    pill: pillFor(f.severity),
  }));

  // ---- Scan coverage (static placeholder — no coverage source wired) ----
  const coverage: SecBar[] = [
    { lab: 'Dependencies', pct: 92, color: 'var(--ok)' },
    { lab: 'Secrets', pct: 100, color: 'var(--ok)' },
    { lab: 'Headers', pct: 60, color: 'var(--high)' },
    { lab: 'Access audit', pct: 80, color: 'var(--high)' },
  ];

  // ---- Recent scans (real; top 5) ----
  const scans: SecScan[] = scanRows.slice(0, 5).map((r) => ({
    id: r.id,
    type: r.type,
    findings: r.findings,
    when: r.when,
    pill: scanPill(r),
  }));

  // ---- Posture (static placeholder — no posture source wired) ----
  const posture = { score: 78 };

  const data: SecurityData = { live, kpis, findings, coverage, scans, posture };
  return NextResponse.json(data);
}
