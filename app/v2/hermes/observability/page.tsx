import type { CSSProperties } from 'react';
import { requireSectionPage } from '@/lib/auth';
import { getObservability } from '@/lib/observability/metrics';
import './observability.css';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Hermes · Observability. Read-only dashboard over the P3 spine
// tables (proposals / executions / budget / audit). Server-rendered; every
// metric is mock-safe (getObservability never throws — no DB ⇒ clean zeros with
// live:false). Gated by the same 'hermes' section as the other Hermes pages.

const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;

// Human relative time for the audit feed.
function rel(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Utilisation → colour band (shared by the KPI value + the budget bars).
function pressure(pct: number): 'ok' | 'high' | 'crit' {
  if (pct >= 100) return 'crit';
  if (pct >= 70) return 'high';
  return 'ok';
}

const TINT: Record<'ok' | 'high' | 'crit', string> = {
  ok: 'var(--ok)',
  high: 'var(--high)',
  crit: 'var(--crit)',
};

function fill(pct: number, color: string): CSSProperties {
  return { width: `${Math.min(pct, 100)}%`, background: color };
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'crit' | 'high';
}) {
  return (
    <div className="v2-obs-stat">
      <div className="lab">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ''} v2-obs-num`}>{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export default async function HermesObservabilityPage() {
  await requireSectionPage('hermes');

  const { proposals, executions, budget, audit, live } = await getObservability();

  return (
    <div>
      {/* Header */}
      <div>
        <div className="v2-eyebrow">Hermes · Oversight</div>
        <div className="v2-obs-title-row">
          <h1 className="v2-h1">Agent observability</h1>
          <span className={`v2-obs-badge${live ? ' live' : ''}`}>
            <span className="dot" aria-hidden />
            {live ? 'Live · ops spine' : 'No data yet'}
          </span>
        </div>
        <div className="v2-sub">
          What the platform is doing — proposals, executions, budget spend and
          audit activity across the Hermes safety spine
        </div>
      </div>

      {/* KPI strip */}
      <div className="v2-obs-strip">
        <Stat
          label="Proposals · 24h"
          value={String(proposals.created24h)}
          sub={`${proposals.total} all-time`}
        />
        <Stat
          label="Pending backlog"
          value={String(proposals.pending)}
          sub="awaiting a human"
          tone={proposals.pending > 0 ? 'high' : undefined}
        />
        <Stat
          label="Executions"
          value={String(executions.total)}
          sub={`${executions.failed} failed`}
          tone={executions.failed > 0 ? 'crit' : undefined}
        />
        <Stat
          label="Approval rate"
          value={`${proposals.approvalRatePct}%`}
          sub={`${proposals.sent} sent · ${proposals.dismissed} dismissed`}
        />
        <Stat
          label="Budget used"
          value={`${budget.overallUtilisationPct}%`}
          sub={`${money(budget.totalSpentMinor)} / ${money(budget.totalCapMinor)}`}
          tone={pressure(budget.overallUtilisationPct)}
        />
        <Stat
          label="Audit chain"
          value={audit.chain.ok ? 'OK' : 'BROKEN'}
          sub={`${audit.chain.count} events`}
          tone={audit.chain.ok ? 'ok' : 'crit'}
        />
      </div>

      {/* Row 1 — proposals by persona + tool executions */}
      <div className="v2-obs-grid">
        {/* Proposals per persona */}
        <div className="v2-card" style={{ overflow: 'hidden' }}>
          <div className="v2-card-h">
            <h3>Proposals by agent</h3>
            <span className="v2-pill info">{proposals.byAgent.length} agents</span>
          </div>
          {proposals.byAgent.length === 0 ? (
            <div className="v2-obs-empty">No proposals yet.</div>
          ) : (
            <div className="v2-bars" style={{ padding: 16 }}>
              {proposals.byAgent.map((a) => {
                const pct = proposals.total > 0 ? (a.total / proposals.total) * 100 : 0;
                return (
                  <div className="v2-bar-row v2-obs-bar" key={a.agent}>
                    <span className="lab" title={a.agent}>{a.agent}</span>
                    <span className="v2-track">
                      <span className="v2-fill" style={fill(pct, 'var(--accent)')} />
                    </span>
                    <span className="meta">
                      {a.pending} pend · {a.sent} sent · {a.dismissed} dis
                    </span>
                    <span className="n">{a.total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tool executions */}
        <div className="v2-card" style={{ overflow: 'hidden' }}>
          <div className="v2-card-h">
            <h3>Tool executions</h3>
            <span className={`v2-pill ${executions.exactlyOnceOk ? 'ok' : 'crit'}`}>
              {executions.exactlyOnceOk
                ? 'exactly-once ✓'
                : `${executions.idempotencyDupes} dupes`}
            </span>
          </div>
          {executions.byTool.length === 0 ? (
            <div className="v2-obs-empty">No executions recorded yet.</div>
          ) : (
            <table className="v2-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th style={{ textAlign: 'right' }}>Runs</th>
                  <th style={{ textAlign: 'right' }}>OK</th>
                  <th style={{ textAlign: 'right' }}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {executions.byTool.map((t) => (
                  <tr key={t.tool}>
                    <td>{t.tool}</td>
                    <td className="v2-obs-num" style={{ textAlign: 'right' }}>{t.runs}</td>
                    <td className="v2-obs-num" style={{ textAlign: 'right' }}>{t.succeeded}</td>
                    <td
                      className={`v2-obs-num${t.failed > 0 ? ' v2-obs-fail' : ''}`}
                      style={{ textAlign: 'right' }}
                    >
                      {t.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Row 2 — budget utilisation + recent activity */}
      <div className="v2-obs-grid">
        {/* Budget bars per persona/tool */}
        <div className="v2-card" style={{ overflow: 'hidden' }}>
          <div className="v2-card-h">
            <h3>Budget utilisation</h3>
            <span className="v2-pill info">
              {money(budget.totalSpentMinor)} / {money(budget.totalCapMinor)}
            </span>
          </div>
          {budget.caps.length === 0 ? (
            <div className="v2-obs-empty">No budget caps configured.</div>
          ) : (
            <div className="v2-bars" style={{ padding: 16 }}>
              {budget.caps.map((c) => {
                const band = pressure(c.utilisationPct);
                const label = c.tool === '*' ? c.persona : `${c.persona} · ${c.tool}`;
                return (
                  <div className="v2-bar-row v2-obs-bar" key={`${c.persona}:${c.tool}:${c.scope}`}>
                    <span className="lab" title={label}>{label}</span>
                    <span className="v2-track">
                      <span className="v2-fill" style={fill(c.utilisationPct, TINT[band])} />
                    </span>
                    <span className="meta">
                      {money(c.spentMinor)} / {money(c.capMinor)}
                    </span>
                    <span className="n">{c.utilisationPct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent audit activity feed */}
        <div className="v2-card" style={{ overflow: 'hidden' }}>
          <div className="v2-card-h">
            <h3>Recent activity</h3>
            <span className="v2-pill info">{audit.last24h} in 24h</span>
          </div>
          {audit.feed.length === 0 ? (
            <div className="v2-obs-empty">No audit activity yet.</div>
          ) : (
            <div className="v2-feed">
              {audit.feed.map((f, i) => (
                <div className="v2-fitem" key={i}>
                  <span className="v2-obs-act">{f.action}</span>
                  <div>
                    <div className="t">{f.summary || f.action}</div>
                    <div className="d">
                      <span>{f.actor || 'system'}</span>
                      {f.tool ? <span>· {f.tool}</span> : null}
                    </div>
                  </div>
                  <span className="d" style={{ whiteSpace: 'nowrap' }}>{rel(f.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit action breakdown */}
      <div className="v2-obs-sec">Audit activity by action</div>
      <div className="v2-card" style={{ overflow: 'hidden' }}>
        {audit.byAction.length === 0 ? (
          <div className="v2-obs-empty">No audit events recorded yet.</div>
        ) : (
          <table className="v2-table">
            <thead>
              <tr>
                <th>Action</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Last 24h</th>
              </tr>
            </thead>
            <tbody>
              {audit.byAction.map((a) => (
                <tr key={a.action}>
                  <td>{a.action}</td>
                  <td className="v2-obs-num" style={{ textAlign: 'right' }}>{a.total}</td>
                  <td className="v2-obs-num" style={{ textAlign: 'right' }}>{a.last24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
