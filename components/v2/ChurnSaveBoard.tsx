'use client';

// Churn-Save Outreach board — ranked at-risk accounts, each with a gated
// "Draft win-back → Queue for approval" flow.
//
// Reads GET /api/v2/admin/churn-save for the ranked list. Per card:
//   • "Draft win-back" → POST { action:'draft' } → shows the drafted email inline.
//   • "Queue for approval" → POST { action:'queue' } → persists a GATED proposal
//     (kind 'churn-save'). NOTHING sends — a human approves it in the Approvals
//     queue. The button copy makes the gate explicit.
// Namespaced v2-cs-* so nothing leaks; colour comes from shell tokens only.

import { useState } from 'react';
import useSWR from 'swr';

type AtRiskAccount = {
  key: string;
  tenantRef: string | null;
  email: string | null;
  label: string;
  riskScore: number;
  reasons: string[];
  lastSignal: string | null;
  failedPayments: number;
  openTickets: number;
};
type WinBackDraft = { to: string | null; subject: string; body: string; refined: boolean; model?: string };
type ListResp = { accounts: AtRiskAccount[]; live: boolean; brain: boolean };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

// Risk band → tint token + label, matching the shell's severity language.
function band(score: number): { tint: string; label: string } {
  if (score >= 60) return { tint: 'var(--crit)', label: 'High risk' };
  if (score >= 35) return { tint: 'var(--high)', label: 'Elevated' };
  return { tint: 'var(--sky)', label: 'Watch' };
}

function LockIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

type CardState = {
  busy: 'draft' | 'queue' | null;
  draft: WinBackDraft | null;
  queued: boolean;
  persisted: boolean;
  error: string | null;
};

const EMPTY: CardState = { busy: null, draft: null, queued: false, persisted: false, error: null };

export default function ChurnSaveBoard() {
  const { data, error } = useSWR<ListResp>('/api/v2/admin/churn-save', fetcher);
  const [cards, setCards] = useState<Record<string, CardState>>({});

  function set(key: string, next: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY), ...next } }));
  }

  async function post(key: string, action: 'draft' | 'queue') {
    set(key, { busy: action, error: null });
    try {
      const res = await fetch('/api/v2/admin/churn-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, key }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; draft?: WinBackDraft; queued?: boolean; persisted?: boolean }
        | null;
      if (!res.ok || !body?.ok) {
        set(key, { busy: null, error: body?.error || `Failed (${res.status}).` });
        return;
      }
      set(key, {
        busy: null,
        error: null,
        draft: body.draft ?? null,
        queued: Boolean(body.queued),
        persisted: Boolean(body.persisted),
      });
    } catch {
      set(key, { busy: null, error: 'Network error — please retry.' });
    }
  }

  if (!data && !error) {
    return (
      <div className="v2-card v2-cs-card">
        <div className="v2-cs-empty">Scoring at-risk accounts…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="v2-card v2-cs-card">
        <div className="v2-cs-empty">Couldn&apos;t load at-risk accounts.</div>
      </div>
    );
  }

  const accounts = data?.accounts ?? [];
  if (accounts.length === 0) {
    return (
      <div className="v2-card v2-cs-card">
        <div className="v2-cs-empty">No at-risk accounts right now — nice.</div>
        {data?.live === false && (
          <div className="v2-cs-empty-note">No database in this environment — scored from sample signals.</div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="v2-cs-grid">
        {accounts.map((a) => {
          const st = cards[a.key] ?? EMPTY;
          const b = band(a.riskScore);
          return (
            <div key={a.key} className="v2-card v2-cs-item" style={{ ['--tint' as string]: b.tint } as React.CSSProperties}>
              <div className="v2-cs-head">
                <div className="v2-cs-name">
                  <span className="v2-cs-label">{a.label}</span>
                  {a.email && a.email !== a.label && <span className="v2-cs-sub">{a.email}</span>}
                </div>
                <div className="v2-cs-score" title={`Risk score ${a.riskScore}/100`}>
                  <span className="v2-cs-score-n">{a.riskScore}</span>
                  <span className={`v2-cs-band`}>{b.label}</span>
                </div>
              </div>

              <div className="v2-cs-stats">
                {a.failedPayments > 0 && <span className="v2-cs-stat crit">{a.failedPayments} failed payment{a.failedPayments > 1 ? 's' : ''}</span>}
                {a.openTickets > 0 && <span className="v2-cs-stat">{a.openTickets} open ticket{a.openTickets > 1 ? 's' : ''}</span>}
                {a.lastSignal && <span className="v2-cs-stat muted">Last: {a.lastSignal}</span>}
              </div>

              <ul className="v2-cs-reasons">
                {a.reasons.slice(0, 4).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>

              {st.draft && (
                <div className="v2-cs-draft">
                  <div className="v2-cs-draft-head">
                    <span className="v2-cs-draft-lbl">Drafted win-back</span>
                    <span className={`v2-cs-tag ${st.draft.refined ? 'ai' : 'tpl'}`}>
                      {st.draft.refined ? `AI-refined${st.draft.model ? ` · ${st.draft.model}` : ''}` : 'Template'}
                    </span>
                  </div>
                  <div className="v2-cs-field"><span className="v2-cs-k">To</span> {st.draft.to ?? '(no email on file)'}</div>
                  <div className="v2-cs-field"><span className="v2-cs-k">Subject</span> {st.draft.subject}</div>
                  <pre className="v2-cs-body">{st.draft.body}</pre>
                </div>
              )}

              {st.error && <div className="v2-cs-err">{st.error}</div>}

              <div className="v2-cs-actions">
                {!st.queued ? (
                  <>
                    <button
                      type="button"
                      className="v2-btn v2-cs-btn"
                      onClick={() => post(a.key, 'draft')}
                      disabled={st.busy !== null}
                    >
                      {st.busy === 'draft' ? 'Drafting…' : st.draft ? 'Re-draft' : 'Draft win-back'}
                    </button>
                    {st.draft && (
                      <button
                        type="button"
                        className="v2-btn v2-cs-btn primary"
                        onClick={() => post(a.key, 'queue')}
                        disabled={st.busy !== null}
                        title="Creates a draft proposal — a human approves before anything sends."
                      >
                        <LockIcon /> {st.busy === 'queue' ? 'Queuing…' : 'Queue for approval'}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="v2-cs-queued">
                    <LockIcon /> Queued for approval{st.persisted ? '' : ' (preview — no DB)'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="v2-cs-foot">
        <LockIcon />
        Every win-back is a DRAFT. Nothing is ever sent until you approve it in the Approvals queue.
        {data?.brain === false && ' · Brain off — drafts use the deterministic template.'}
      </div>
    </>
  );
}
