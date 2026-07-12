'use client';

// Hermes · Incident Commander client. Loads active incidents + their assembled
// context from GET /api/v2/admin/incident-commander and renders one card per
// incident: firing alerts, monitoring state, recent deploys, related tickets and
// a timeline. Each card can:
//   • "Open incident" (alert-only candidates) — POST action:'open-incident'
//   • "Draft status update" — POST action:'draft-status' → preview + a QUEUED
//     incident-status proposal (nothing is posted).
//   • "Queue broadcast" on the preview — POST action:'approve-broadcast' → the
//     GATED broadcast runs, and the proposal is marked sent.
//
// Namespaced v2-ic-* so nothing leaks; colours come from the v2 shell tokens.

import { useEffect, useState } from 'react';

type Sev = 'critical' | 'warning' | 'info' | 'other';
type Overall = 'operational' | 'degraded' | 'down';

type ActiveIncident = {
  ref: string | null;
  title: string;
  status: string;
  priority: string;
  app: string;
  service: string | null;
  source: 'ticket' | 'alert';
  severity?: Sev;
};

type IncidentAlert = { name: string; severity: Sev; summary: string; startsAt: string; service: string | null; correlated: boolean };
type RelatedTicket = { ref: string; kind: string; title: string; status: string; priority: string; app: string; matchedOn: string[] };
type DeployRepo = { repo: string; latestRun?: { name: string; branch: string; status: string; conclusion: string | null; url: string }; openPRs: Array<{ number: number; title: string; ageDays: number; url: string }>; error?: string };
type MonitoringState = { overall: Overall; source: string; alertsFiring: number; monitorsDown: string[]; note?: string };
type TimelineEvent = { at: string; kind: string; label: string };

type IncidentContext = {
  incidentRef: string | null;
  title: string;
  primaryService: string | null;
  severity: Sev | null;
  alerts: IncidentAlert[];
  relatedTickets: RelatedTicket[];
  recentDeploys: { configured: boolean; summary: string; repos: DeployRepo[] };
  monitoringState: MonitoringState;
  timeline: TimelineEvent[];
  assembledAt: string;
};

type StatusDraft = { text: string; generatedBy: 'template' | 'llm'; headline: string; affected: string; impact: string; action: string; eta: string; model?: string };
type Row = { incident: ActiveIncident; context: IncidentContext };
type Feed = { ok: boolean; brainEnabled: boolean; incidents: Row[]; error?: string };

const fetchJson = (u: string, init?: RequestInit) => fetch(u, init).then((r) => r.json());

function sevCls(s: Sev | string | null): string {
  if (s === 'critical' || s === 'down') return 'crit';
  if (s === 'warning' || s === 'degraded' || s === 'high') return 'high';
  if (s === 'operational') return 'ok';
  return 'info';
}
function overallLabel(o: Overall): string {
  return o === 'down' ? 'Down' : o === 'degraded' ? 'Degraded' : 'Operational';
}
function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function IncidentCommander() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchJson('/api/v2/admin/incident-commander')) as Feed;
      if (!data.ok) setError(data.error ?? 'Failed to load incidents.');
      setFeed(data);
    } catch {
      setError('Network error while loading incidents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading && !feed) return <div className="v2-ic-empty">Assembling incident context…</div>;

  const rows = feed?.incidents ?? [];

  return (
    <div className="v2-ic">
      <div className="v2-ic-bar">
        <span className={`v2-pill ${feed?.brainEnabled ? 'ok' : 'info'}`}>
          {feed?.brainEnabled ? 'Brain on · LLM narrative' : 'Brain off · template'}
        </span>
        <span className="v2-ic-sub">{rows.length} active {rows.length === 1 ? 'incident' : 'incidents'}</span>
        <button className="v2-btn ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <div className="v2-ic-err">{error}</div> : null}

      {rows.length === 0 && !error ? (
        <div className="v2-ic-card">
          <div className="v2-ic-none">
            No active incidents or firing alerts right now. This surface lights up when Alertmanager reports a firing
            critical/warning alert, or when an incident ticket is open.
          </div>
        </div>
      ) : null}

      {rows.map((row, i) => (
        <IncidentCard key={row.incident.ref ?? `cand-${i}`} row={row} onChanged={() => void load()} />
      ))}
    </div>
  );
}

function IncidentCard({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const { incident, context } = row;
  const [draft, setDraft] = useState<StatusDraft | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function openIncident() {
    setBusy('open');
    setNotice(null);
    try {
      const res = await fetchJson('/api/v2/admin/incident-commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open-incident', from: incident }),
      });
      if (res.ok) {
        setNotice({ kind: 'ok', msg: `Opened ${res.ref}` });
        onChanged();
      } else setNotice({ kind: 'err', msg: res.error ?? 'Failed to open incident.' });
    } catch {
      setNotice({ kind: 'err', msg: 'Network error.' });
    } finally {
      setBusy(null);
    }
  }

  async function draftStatus() {
    setBusy('draft');
    setNotice(null);
    try {
      const res = await fetchJson('/api/v2/admin/incident-commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft-status', incident }),
      });
      if (res.ok) {
        setDraft(res.draft as StatusDraft);
        setProposalId(res.proposalId ?? null);
        setNotice(
          res.queued
            ? { kind: 'ok', msg: 'Draft queued in the approval queue — not posted.' }
            : { kind: 'ok', msg: 'Draft ready (no DB → not persisted).' },
        );
      } else setNotice({ kind: 'err', msg: res.error ?? 'Failed to draft status.' });
    } catch {
      setNotice({ kind: 'err', msg: 'Network error.' });
    } finally {
      setBusy(null);
    }
  }

  async function queueBroadcast() {
    if (!draft || !proposalId) {
      setNotice({ kind: 'err', msg: 'No queued proposal to broadcast (needs a DB-backed proposal).' });
      return;
    }
    setBusy('broadcast');
    setNotice(null);
    try {
      const res = await fetchJson('/api/v2/admin/incident-commander', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve-broadcast', proposalId, text: draft.text }),
      });
      if (res.ok) setNotice({ kind: 'ok', msg: `Broadcast approved (${res.via ?? 'sent'}).` });
      else setNotice({ kind: 'err', msg: res.error ?? 'Broadcast failed.' });
    } catch {
      setNotice({ kind: 'err', msg: 'Network error.' });
    } finally {
      setBusy(null);
    }
  }

  const mon = context.monitoringState;

  return (
    <div className="v2-ic-card">
      {/* Header */}
      <div className="v2-ic-head">
        <div className="v2-ic-title">
          <span className={`v2-pill ${sevCls(context.severity)}`}>{context.severity ?? 'unknown'}</span>
          <div>
            <div className="v2-ic-name">
              {incident.ref ? <span className="v2-ic-ref">{incident.ref}</span> : <span className="v2-ic-ref cand">CANDIDATE</span>}{' '}
              {incident.title}
            </div>
            <div className="v2-ic-meta">
              {incident.app} · {incident.status} · {incident.service ?? 'service tbd'} ·{' '}
              {incident.source === 'alert' ? 'from alert' : 'tracked ticket'}
            </div>
          </div>
        </div>
        <div className="v2-ic-actions">
          {incident.source === 'alert' && !incident.ref ? (
            <button className="v2-btn" onClick={() => void openIncident()} disabled={busy !== null}>
              {busy === 'open' ? 'Opening…' : 'Open incident'}
            </button>
          ) : null}
          <button className="v2-btn ghost" onClick={() => void draftStatus()} disabled={busy !== null}>
            {busy === 'draft' ? 'Drafting…' : 'Draft status update'}
          </button>
        </div>
      </div>

      {notice ? <div className={notice.kind === 'ok' ? 'v2-ic-ok' : 'v2-ic-err'}>{notice.msg}</div> : null}

      {/* Grid of context panels */}
      <div className="v2-ic-grid">
        {/* Monitoring */}
        <div className="v2-ic-panel">
          <div className="v2-ic-ph">Monitoring</div>
          <div className="v2-ic-line">
            <span className={`v2-pill ${sevCls(mon.overall)}`}>{overallLabel(mon.overall)}</span>
            <span className="v2-ic-dim">via {mon.source} · {mon.alertsFiring} firing</span>
          </div>
          {mon.monitorsDown.length ? (
            <div className="v2-ic-dim">Down: {mon.monitorsDown.join(', ')}</div>
          ) : null}
          {mon.note ? <div className="v2-ic-dim">{mon.note}</div> : null}
        </div>

        {/* Firing alerts */}
        <div className="v2-ic-panel">
          <div className="v2-ic-ph">Firing alerts</div>
          {context.alerts.length === 0 ? (
            <div className="v2-ic-dim">No firing alerts.</div>
          ) : (
            context.alerts.map((a, i) => (
              <div key={`${a.name}-${i}`} className="v2-ic-line">
                <span className={`v2-pill ${sevCls(a.severity)}`}>{a.severity}</span>
                <span className={a.correlated ? 'v2-ic-strong' : ''}>{a.name}</span>
                {a.correlated ? <span className="v2-ic-tag">correlated</span> : null}
              </div>
            ))
          )}
        </div>

        {/* Recent deploys */}
        <div className="v2-ic-panel">
          <div className="v2-ic-ph">Recent deploys / CI</div>
          {!context.recentDeploys.configured ? (
            <div className="v2-ic-dim">{context.recentDeploys.summary}</div>
          ) : context.recentDeploys.repos.length === 0 ? (
            <div className="v2-ic-dim">No recent runs.</div>
          ) : (
            context.recentDeploys.repos.map((r) => (
              <div key={r.repo} className="v2-ic-line">
                {r.latestRun ? (
                  <span className={`v2-pill ${r.latestRun.conclusion === 'success' ? 'ok' : r.latestRun.conclusion === 'failure' ? 'crit' : 'info'}`}>
                    {r.latestRun.conclusion ?? r.latestRun.status}
                  </span>
                ) : null}
                <span>{r.repo}{r.latestRun ? ` · ${r.latestRun.branch}` : ''}{r.openPRs.length ? ` · ${r.openPRs.length} open PR(s)` : ''}</span>
              </div>
            ))
          )}
        </div>

        {/* Related tickets */}
        <div className="v2-ic-panel">
          <div className="v2-ic-ph">Related tickets</div>
          {context.relatedTickets.length === 0 ? (
            <div className="v2-ic-dim">No correlated tickets.</div>
          ) : (
            context.relatedTickets.map((r) => (
              <div key={r.ref} className="v2-ic-line">
                <span className={`v2-pill ${sevCls(r.priority)}`}>{r.kind}</span>
                <span>{r.ref} · {r.title}</span>
                <span className="v2-ic-tag">{r.matchedOn.join(', ')}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="v2-ic-panel">
        <div className="v2-ic-ph">Timeline</div>
        {context.timeline.length === 0 ? (
          <div className="v2-ic-dim">No timeline events.</div>
        ) : (
          <div className="v2-ic-timeline">
            {context.timeline.map((e, i) => (
              <div key={i} className="v2-ic-tl">
                <span className={`v2-ic-dot ${e.kind}`} />
                <span className="v2-ic-tl-at">{fmtTime(e.at) || '—'}</span>
                <span>{e.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status draft preview + gated broadcast */}
      {draft ? (
        <div className="v2-ic-draft">
          <div className="v2-ic-ph">
            Status draft
            <span className={`v2-pill ${draft.generatedBy === 'llm' ? 'ok' : 'info'}`}>
              {draft.generatedBy === 'llm' ? `LLM · ${draft.model ?? 'model'}` : 'template'}
            </span>
          </div>
          <pre className="v2-ic-pre">{draft.text}</pre>
          <div className="v2-ic-draft-foot">
            <button
              className="v2-btn"
              onClick={() => void queueBroadcast()}
              disabled={busy !== null || !proposalId}
              title={proposalId ? 'Approve & broadcast this status update' : 'Needs a DB-backed proposal to broadcast'}
            >
              {busy === 'broadcast' ? 'Broadcasting…' : 'Queue broadcast (gated)'}
            </button>
            <span className="v2-ic-dim">
              Queued as an <code>incident-status</code> proposal. Broadcast only runs on your approval.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
