'use client';

// Live approval queue for the v2 Hermes oversight page — the visible HUMAN GATE.
// Reads REAL persisted proposals and lets the operator approve/deny each one.
//
// Two kinds of proposal share this queue:
//   • ACTION  — a gated tool call the Brain paused on (proposal.action present).
//               Approve RESUMES the graph and EXECUTES the tool for real. The card
//               shows exactly WHAT will run: the tool + its args ("what will
//               execute"), expandable so the reviewer can audit before approving.
//   • DRAFT   — a copilot-drafted customer reply. Approve posts the draft as a
//               reply (legacy behaviour). Shows a preview + confidence.
//
// Endpoints:
//   - GET  /api/hermes/proposals                    → { proposals, live } (queue feed)
//   - POST /api/hermes/proposals/[id]/approve       → { ok, error? }
//   - POST /api/hermes/proposals/[id]/deny          → { ok, error? }
// Polling is inherited from the ancestor <SWRConfig> (RefreshProvider) — no
// interval is set here. Namespaced v2-apq-* so nothing leaks; colour comes from
// shell tokens only.

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

import type { HermesProposalRecord } from '@/lib/hermes/proposals';

type ProposalsResp = { proposals: HermesProposalRecord[]; live: boolean };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Clamp an arbitrary number to a 0-100 integer percentage.
function clampPct(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Left-edge tint derived from the proposal priority so the queue keeps the
// same visual language as the old mock (crit = money/security, etc.).
function tintFor(record: HermesProposalRecord): string {
  const p = (record.proposal.priority || '').toLowerCase();
  if (p === 'urgent') return 'var(--crit)';
  if (p === 'high') return 'var(--high)';
  if (p === 'low') return 'var(--sky)';
  return 'var(--accent)';
}

// Truncate a draft to a short preview for the row.
function preview(draft: string | undefined, max = 160): string {
  if (!draft) return '';
  const clean = draft.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Map an agent/department id to a badge tint class (falls back to neutral).
const DEP_CLASSES = new Set([
  'support',
  'access',
  'billing',
  'security',
  'escalations',
]);
function depClass(agent: string): string {
  const a = agent.toLowerCase();
  return DEP_CLASSES.has(a) ? ` ${a}` : '';
}

// Status pill wording + tint class, derived from the record status and whether
// the gated tool actually executed.
function pillFor(p: HermesProposalRecord): { label: string; cls: string } {
  const isAction = Boolean(p.proposal.action?.tool);
  if (p.status === 'pending') return { label: 'Pending review', cls: 'pending' };
  if (p.status === 'dismissed') return { label: 'Denied', cls: 'denied' };
  // status === 'sent'
  if (isAction) return { label: 'Executed', cls: 'exec' };
  return { label: 'Sent', cls: 'sent' };
}

// Pretty-print tool args for the "what will execute" panel.
function prettyArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return '(no arguments)';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

type RowState = { busy: 'approve' | 'deny' | null; error: string | null };

function LockIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function ApprovalsQueue() {
  // Global refreshInterval comes from the ancestor <SWRConfig> (RefreshProvider),
  // so polling is automatic — do not set an interval here. No `status` param → the
  // queue feed: pending first, then recently-decided rows (shown read-only).
  const { data, error, mutate } = useSWR<ProposalsResp>(
    '/api/hermes/proposals',
    fetcher,
  );

  // Per-row acting/error state, keyed by proposal id.
  const [rows, setRows] = useState<Record<string, RowState>>({});

  function setRow(id: string, next: RowState) {
    setRows((prev) => ({ ...prev, [id]: next }));
  }

  async function act(id: string, action: 'approve' | 'deny') {
    setRow(id, { busy: action, error: null });
    try {
      const res = await fetch(
        `/api/hermes/proposals/${encodeURIComponent(id)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!res.ok || !body?.ok) {
        setRow(id, {
          busy: null,
          error: body?.error || `Action failed (${res.status}).`,
        });
        return;
      }

      // Success — clear row state and optimistically flip the row's status so it
      // becomes read-only immediately, then revalidate for the executed result.
      setRow(id, { busy: null, error: null });
      const nextStatus: HermesProposalRecord['status'] =
        action === 'approve' ? 'sent' : 'dismissed';
      await mutate(
        (cur) =>
          cur
            ? {
                ...cur,
                proposals: cur.proposals.map((x) =>
                  x.id === id ? { ...x, status: nextStatus } : x,
                ),
              }
            : cur,
        { revalidate: true },
      );
    } catch {
      setRow(id, { busy: null, error: 'Network error — please retry.' });
    }
  }

  const proposals = data?.proposals ?? [];

  // ---------- Loading ----------
  if (!data && !error) {
    return (
      <div className="v2-card v2-apq-card">
        <div className="v2-apq-empty">Loading proposals…</div>
      </div>
    );
  }

  // ---------- Error ----------
  if (error) {
    return (
      <div className="v2-card v2-apq-card">
        <div className="v2-apq-empty">Couldn&apos;t load proposals.</div>
      </div>
    );
  }

  // ---------- Empty ----------
  if (proposals.length === 0) {
    return (
      <div className="v2-card v2-apq-card">
        <div className="v2-apq-empty">No proposals awaiting review.</div>
        {data?.live === false && (
          <div className="v2-apq-empty-note">
            No database in this environment — proposals persist in production.
          </div>
        )}
      </div>
    );
  }

  // ---------- Queue ----------
  return (
    <div className="v2-card v2-apq-card">
      {proposals.map((p) => {
        const st = rows[p.id] ?? { busy: null, error: null };
        const action = p.proposal.action;
        const isAction = Boolean(action?.tool);
        const decided = p.status !== 'pending';
        const persona = action?.persona || p.agent || 'hermes';
        const pill = pillFor(p);
        const label = p.proposal.classification || p.summary || '';
        const conf = clampPct(p.proposal.confidence);
        const showConf = !isAction && conf > 0;
        return (
          <div
            key={p.id}
            className={`v2-apq-row${decided ? ' is-decided' : ''}`}
            style={{ ['--tint' as string]: tintFor(p) } as React.CSSProperties}
          >
            <div className="v2-apq-body">
              <div className="v2-apq-head">
                <span className={`v2-apq-dep${depClass(persona)}`}>{persona}</span>
                {isAction && action?.tool && (
                  <code className="v2-apq-tool">{action.tool}</code>
                )}
                <span className={`v2-apq-pill ${pill.cls}`}>{pill.label}</span>
              </div>

              <div className="v2-apq-title">{p.title}</div>

              <div className="v2-apq-meta">
                <span className="v2-apq-kind">{p.kind}</span>
                {p.ref && (
                  <Link href={`/v2/support/${p.ref}`} className="v2-apq-target">
                    {p.ref}
                  </Link>
                )}
                {label && (
                  <>
                    <span className="v2-apq-dot">·</span>
                    <span className="v2-apq-guard">{label}</span>
                  </>
                )}
              </div>

              {/* ACTION → show exactly WHAT will execute (tool + args). */}
              {isAction && action && (
                <details className="v2-apq-exec">
                  <summary>
                    <span className="v2-apq-exec-lbl">
                      <LockIcon /> What will execute
                    </span>
                    <span className="v2-apq-exec-tool">{action.tool}</span>
                  </summary>
                  <div className="v2-apq-exec-body">
                    <div className="v2-apq-exec-cap">Tool</div>
                    <code className="v2-apq-exec-name">{action.tool}</code>
                    <div className="v2-apq-exec-cap">Arguments</div>
                    <pre className="v2-apq-args">{prettyArgs(action.args)}</pre>
                    {action.executedAt && (
                      <div className="v2-apq-exec-result">
                        <span className="v2-apq-exec-cap">Result</span>
                        <div className="v2-apq-exec-res">
                          {action.result || 'executed'}
                        </div>
                        <div className="v2-apq-exec-when">
                          Ran {new Date(action.executedAt).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* DRAFT → show the drafted reply preview (legacy copilot flow). */}
              {!isAction && p.proposal.draft && (
                <div className="v2-apq-draft">{preview(p.proposal.draft)}</div>
              )}

              {st.error && <div className="v2-apq-rowerr">{st.error}</div>}
            </div>

            <div className="v2-apq-right">
              {showConf && (
                <div className="v2-apq-conf">
                  {conf}%<small>confidence</small>
                </div>
              )}

              {decided ? (
                // Read-only — already actioned. The pill above carries the outcome.
                <span className="v2-apq-done">{pill.label}</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="v2-btn v2-apq-approve"
                    onClick={() => act(p.id, 'approve')}
                    disabled={st.busy !== null}
                  >
                    {st.busy === 'approve'
                      ? 'Working…'
                      : isAction
                        ? 'Approve & run'
                        : 'Approve & send'}
                  </button>
                  <button
                    type="button"
                    className="v2-apq-deny"
                    aria-label="Deny"
                    onClick={() => act(p.id, 'deny')}
                    disabled={st.busy !== null}
                    title="Deny"
                  >
                    {st.busy === 'deny' ? '…' : '×'}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {data?.live === false && (
        <div className="v2-apq-foot">
          <LockIcon />
          No database in this environment — proposals persist in production.
        </div>
      )}
    </div>
  );
}
