'use client';

// Live Hermes copilot panel for the v2 ticket detail pages. Mounts inside the
// server-rendered ticket views and drives two real APIs:
//   - POST /api/hermes/triage           { ref }   → HermesProposal (sibling-built)
//   - POST /api/tickets/[ref]/comments  { body, kind } → posts the reply
// Copilot-first: Hermes DRAFTS into an editable textarea; nothing sends until
// the operator clicks "Send reply". In dev (no OPENROUTER_API_KEY) triage
// returns configured:false and the panel shows a "not configured" note.
// Namespaced v2-hz-* so nothing leaks; colour comes from shell tokens only.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { HermesProposal } from '@/lib/hermes/types';
import { AGENT_META, type AgentKey } from '@/lib/hermes/agent-meta';

import './hermes-panel.css';

type Props = { refId: string; agent?: AgentKey };

// UI phase for the panel body.
type Phase = 'idle' | 'loading' | 'result';

const NO_DB = "Couldn't send — no database in this environment.";

function clampPct(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export default function HermesPanel({ refId, agent = 'support' }: Props) {
  const router = useRouter();
  const meta = AGENT_META[agent];

  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<HermesProposal | null>(null);
  // Saved proposal id from triage (null when no DB); used to mark the queued
  // proposal as sent once the operator dispatches the reply.
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable draft — seeded from the proposal, then owned by the operator.
  const [draft, setDraft] = useState('');

  // Send-reply state (separate from the triage/loading state).
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const notConfigured = proposal?.configured === false;

  async function runTriage() {
    setPhase('loading');
    setError(null);
    setSent(false);
    setSendError(null);

    try {
      const res = await fetch('/api/hermes/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: refId, agent }),
      });
      const data = (await res.json().catch(() => null)) as
        | (HermesProposal & { id?: string | null })
        | null;

      if (!data) {
        setProposal(null);
        setProposalId(null);
        setError(`Hermes could not be reached (${res.status}).`);
        setPhase('result');
        return;
      }

      setProposal(data);
      setProposalId(typeof data.id === 'string' ? data.id : null);
      if (data.ok && typeof data.draft === 'string') {
        setDraft(data.draft);
      }
      setPhase('result');
    } catch {
      setProposal(null);
      setError('Network error — could not reach Hermes.');
      setPhase('result');
    }
  }

  async function sendReply() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setSent(false);
    setSendError(null);

    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(refId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, kind: meta.commentKind }),
        },
      );
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setSendError(res.status >= 500 ? NO_DB : data?.error || `Send failed (${res.status}).`);
        setSending(false);
        return;
      }

      setSending(false);
      setSent(true);

      // Best-effort: mark the queued proposal as sent so the approvals queue
      // drops it. Ignore failures — the reply already went out.
      if (proposalId) {
        try {
          await fetch(`/api/hermes/proposals/${encodeURIComponent(proposalId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark-sent' }),
          });
        } catch {
          /* ignore — best-effort */
        }
      }

      router.refresh();
    } catch {
      setSendError('Network error — could not send the reply.');
      setSending(false);
    }
  }

  return (
    <div className="v2-card v2-hz-card">
      <div className="v2-card-h v2-hz-head">
        <h3>{meta.header}</h3>
        <span className="v2-hz-badge">Copilot</span>
      </div>

      <div className="v2-hz-body">
        {/* ---------- IDLE ---------- */}
        {phase === 'idle' && (
          <>
            <p className="v2-hz-tagline">{meta.tagline}</p>
            <div className="v2-hz-actions">
              <button type="button" className="v2-btn v2-hz-primary" onClick={runTriage}>
                {meta.button}
              </button>
            </div>
          </>
        )}

        {/* ---------- LOADING ---------- */}
        {phase === 'loading' && (
          <div className="v2-hz-loading" role="status" aria-live="polite">
            <span>Hermes is drafting</span>
            <span className="v2-hz-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}

        {/* ---------- RESULT ---------- */}
        {phase === 'result' && (
          <>
            {/* Not configured (dev / no key) */}
            {notConfigured && (
              <>
                <div className="v2-hz-note">
                  Hermes isn&apos;t configured yet — set <code>OPENROUTER_API_KEY</code> to enable drafting.
                </div>
                <div className="v2-hz-actions">
                  <button type="button" className="v2-btn v2-hz-primary" disabled>
                    {meta.button}
                  </button>
                </div>
              </>
            )}

            {/* Errored (reachable but not ok) */}
            {!notConfigured && proposal?.ok !== true && (
              <>
                <div className="v2-hz-err">
                  {proposal?.error || error || 'Hermes could not draft a reply.'}
                </div>
                <div className="v2-hz-actions">
                  <button type="button" className="v2-btn ghost" onClick={runTriage}>
                    Retry
                  </button>
                </div>
              </>
            )}

            {/* Success — the proposal */}
            {!notConfigured && proposal?.ok === true && (
              <>
                <div className="v2-hz-chips">
                  {proposal.classification && (
                    <span className="v2-pill info v2-hz-chip">{proposal.classification}</span>
                  )}
                  {proposal.priority && (
                    <span className="v2-pill high v2-hz-chip">{proposal.priority}</span>
                  )}
                </div>

                <div className="v2-hz-conf">
                  <div className="v2-hz-conf-top">
                    <span>Confidence</span>
                    <b>{clampPct(proposal.confidence)}%</b>
                  </div>
                  <div className="v2-hz-conf-track">
                    <div
                      className="v2-hz-conf-fill"
                      style={{ width: `${clampPct(proposal.confidence)}%` }}
                    />
                  </div>
                </div>

                {proposal.reasoning && <p className="v2-hz-reason">{proposal.reasoning}</p>}

                {Array.isArray(proposal.sources) && proposal.sources.length > 0 && (
                  <div className="v2-hz-sources">
                    {proposal.sources.map((s) => (
                      <span key={s} className="v2-hz-src">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <label className="v2-hz-draft-lab" htmlFor={`v2-hz-draft-${refId}`}>
                  Draft reply
                </label>
                <textarea
                  id={`v2-hz-draft-${refId}`}
                  className="v2-hz-textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={sending}
                  rows={7}
                />

                {sendError && <div className="v2-hz-err">{sendError}</div>}
                {sent && !sendError && <div className="v2-hz-sent">Sent</div>}

                <div className="v2-hz-actions">
                  <button
                    type="button"
                    className="v2-btn v2-hz-primary"
                    onClick={sendReply}
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? 'Sending…' : meta.action}
                  </button>
                  <button
                    type="button"
                    className="v2-btn ghost"
                    onClick={runTriage}
                    disabled={sending}
                  >
                    Regenerate
                  </button>
                  <span className="v2-hz-caption">draft only — nothing sends without you</span>
                </div>

                {proposal.model && (
                  <div className="v2-hz-model">via {proposal.model}</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
