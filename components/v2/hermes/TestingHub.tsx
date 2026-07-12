'use client';

// Admin Testing hub — two sections on one page:
//
//   A. Live smoke (in-process)  — POST /api/v2/admin/smoke runs the live smoke suite
//      against the RUNNING app (process + DB + config) and renders per-check
//      pass/fail/skip rows + a summary. This proves the DEPLOYED platform works.
//
//   B. CI test suite (GitHub Actions) — the unit/integration/e2e suite runs in CI,
//      not in this process, so this section TRIGGERS the test.yml workflow
//      (POST /api/v2/admin/tests/ci) and shows recent runs (GET, polled while a run
//      is in_progress) with a link to the Actions run.
//
// Namespaced v2-smk-* so nothing leaks; colours come from shell tokens only.

import { useEffect, useState } from 'react';
import useSWR from 'swr';

type SmokeStatus = 'pass' | 'fail' | 'skip';
type SmokeCheck = { name: string; status: SmokeStatus; detail: string; ms: number };
type SmokeSummary = { total: number; pass: number; fail: number; skip: number; ok: boolean };
type SmokeRun = { ranAt: string; ms: number; summary: SmokeSummary; checks: SmokeCheck[] };

type CiRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  url: string | null;
  branch: string | null;
  name: string | null;
};
type CiRunsResp = {
  ok: boolean;
  error?: string;
  message?: string;
  runs: CiRun[];
};
type CiDispatchResp = { ok: boolean; error?: string; message?: string; dispatched?: boolean };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

function statusCls(s: SmokeStatus): string {
  if (s === 'pass') return 'ok';
  if (s === 'fail') return 'crit';
  return 'info';
}

function humanName(n: string): string {
  return n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- CI run status → pill label/tint --------------------------------------
function ciPill(run: CiRun): { label: string; cls: string } {
  if (run.status && run.status !== 'completed') {
    return { label: run.status.replace(/_/g, ' '), cls: 'info' };
  }
  const c = (run.conclusion ?? '').toLowerCase();
  if (c === 'success') return { label: 'success', cls: 'ok' };
  if (c === 'failure' || c === 'timed_out') return { label: c.replace(/_/g, ' '), cls: 'crit' };
  if (c === 'cancelled' || c === 'skipped') return { label: c, cls: 'info' };
  return { label: run.conclusion ?? run.status ?? 'unknown', cls: 'info' };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

// ===========================================================================
// Section A — Live smoke
// ===========================================================================
function LiveSmokeSection() {
  const [catalog, setCatalog] = useState<string[]>([]);
  const [run, setRun] = useState<SmokeRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v2/admin/smoke')
      .then((r) => r.json())
      .then((d) => setCatalog(Array.isArray(d.checks) ? d.checks : []))
      .catch(() => setCatalog([]));
  }, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/v2/admin/smoke', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Run failed (HTTP ${res.status})`);
        return;
      }
      setRun(data as SmokeRun);
    } catch {
      setError('Network error while running the smoke suite.');
    } finally {
      setRunning(false);
    }
  }

  const rows = run?.checks ?? catalog.map((name) => ({ name, status: 'skip' as SmokeStatus, detail: 'not run yet', ms: 0 }));

  return (
    <div className="v2-card v2-smk-card">
      <div className="v2-card-h">
        <div className="v2-set-ch">
          <h3>Live smoke — in-process</h3>
          <span className="st">
            Runs a suite of live health checks against the running app (its own process, DB and config).
            Read-mostly and safe against production — any write is a self-cleaning <code>__smoke__</code> artifact.
          </span>
        </div>
        <button className="v2-btn" onClick={() => void handleRun()} disabled={running}>
          {running ? 'Running…' : 'Run smoke test'}
        </button>
      </div>

      {run ? (
        <div className="v2-smk-summary">
          <span className={`v2-pill ${run.summary.ok ? 'ok' : 'crit'}`}>
            {run.summary.ok ? 'All green' : `${run.summary.fail} failing`}
          </span>
          <span className="v2-smk-sub">
            {run.summary.pass} passed · {run.summary.fail} failed · {run.summary.skip} skipped · {run.ms}ms ·{' '}
            {fmtTime(run.ranAt)}
          </span>
        </div>
      ) : null}

      {error ? <div className="v2-smk-err">{error}</div> : null}

      <div className="v2-smk-rows">
        {rows.map((c) => (
          <div key={c.name} className="v2-smk-row">
            <span className={`v2-pill ${statusCls(c.status)} v2-smk-pill`}>{c.status}</span>
            <div className="v2-smk-body">
              <div className="v2-smk-name">{humanName(c.name)}</div>
              <div className="v2-smk-detail">{c.detail}</div>
            </div>
            <span className="v2-smk-ms">{c.ms ? `${c.ms}ms` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Section B — CI test suite
// ===========================================================================
function CiSuiteSection() {
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Poll while any run is in progress so status/conclusion updates live.
  const { data, mutate } = useSWR<CiRunsResp>('/api/v2/admin/tests/ci', fetcher, {
    refreshInterval: (latest) =>
      latest?.runs?.some((r) => r.status && r.status !== 'completed') ? 5000 : 0,
  });

  const notConfigured = data?.error === 'not_configured';
  const workflowMissing = data?.error === 'workflow_not_found';

  async function handleDispatch() {
    setDispatching(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v2/admin/tests/ci', { method: 'POST' });
      const body = (await res.json()) as CiDispatchResp;
      if (body.ok) {
        setNotice({ kind: 'ok', msg: 'CI suite dispatched on main — watching for the run…' });
        // Give Actions a moment to register the run, then refresh.
        setTimeout(() => void mutate(), 2500);
      } else {
        setNotice({ kind: 'err', msg: body.message ?? body.error ?? 'Dispatch failed.' });
      }
    } catch {
      setNotice({ kind: 'err', msg: 'Network error while dispatching the CI suite.' });
    } finally {
      setDispatching(false);
    }
  }

  const runs = data?.runs ?? [];

  return (
    <div className="v2-card v2-smk-card">
      <div className="v2-card-h">
        <div className="v2-set-ch">
          <h3>CI test suite — GitHub Actions</h3>
          <span className="st">
            The unit / integration / e2e suite runs in CI, not in this process. Triggers the{' '}
            <code>test.yml</code> workflow on <code>lewis159/sentinel@main</code> and shows recent runs.
          </span>
        </div>
        <button
          className="v2-btn"
          onClick={() => void handleDispatch()}
          disabled={dispatching || notConfigured}
          title={notConfigured ? 'set HERMES_GITHUB_TOKEN' : undefined}
        >
          {dispatching ? 'Dispatching…' : 'Run CI suite'}
        </button>
      </div>

      {notConfigured ? (
        <div className="v2-smk-err">
          Not configured — set <code>HERMES_GITHUB_TOKEN</code> (a PAT with actions:write on lewis159/sentinel).
        </div>
      ) : null}
      {workflowMissing ? (
        <div className="v2-smk-note">CI workflow not merged yet — <code>test.yml</code> is not on main.</div>
      ) : null}
      {notice ? (
        <div className={notice.kind === 'ok' ? 'v2-smk-note' : 'v2-smk-err'}>{notice.msg}</div>
      ) : null}

      <div className="v2-smk-rows">
        {runs.length === 0 && !notConfigured ? (
          <div className="v2-smk-empty">No recent runs.</div>
        ) : (
          runs.map((r) => {
            const pill = ciPill(r);
            return (
              <div key={r.id} className="v2-smk-row">
                <span className={`v2-pill ${pill.cls} v2-smk-pill`}>{pill.label}</span>
                <div className="v2-smk-body">
                  <div className="v2-smk-name">{r.name ?? 'test.yml'}</div>
                  <div className="v2-smk-detail">
                    {r.branch ?? 'main'} · {fmtTime(r.createdAt)}
                  </div>
                </div>
                {r.url ? (
                  <a className="v2-smk-link" href={r.url} target="_blank" rel="noreferrer">
                    View run →
                  </a>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function TestingHub() {
  return (
    <div className="v2-smk">
      <LiveSmokeSection />
      <CiSuiteSection />
    </div>
  );
}
