'use client';

// Onboarding board — one card per recent customer: first-success progress bar,
// milestone checklist, unused-feature chips, and a gated "Draft nudge" flow.
//
// The card fetches nothing on mount — it renders the server-provided snapshot.
// "Draft nudge" POSTs to /api/v2/admin/onboarding to preview the copy; "Queue
// for approval" POSTs again with { queue:true } to raise it to the Approvals
// queue. NOTHING sends from here — approval + the gated email tool are the only
// send path. Namespaced v2-onb-* so nothing leaks.

import { useState } from 'react';
import Link from 'next/link';
import type { OnboardingProgress } from '@/lib/onboarding/progress';

type NudgeDraft = {
  subject: string;
  body: string;
  featureKey: string | null;
  personalised: boolean;
  model?: string;
};

type DraftState = {
  busy: 'draft' | 'queue' | null;
  draft: NudgeDraft | null;
  queued: boolean;
  proposalId: string | null;
  persisted: boolean;
  error: string | null;
};

const EMPTY: DraftState = {
  busy: null,
  draft: null,
  queued: false,
  proposalId: null,
  persisted: false,
  error: null,
};

function stageClass(stage: OnboardingProgress['stage']): string {
  switch (stage) {
    case 'active':
      return 'ok';
    case 'stalled':
      return 'crit';
    case 'activating':
      return 'high';
    default:
      return 'info';
  }
}

const STAGE_LABEL: Record<OnboardingProgress['stage'], string> = {
  new: 'New',
  activating: 'Activating',
  active: 'Active',
  stalled: 'Stalled',
};

function CheckIcon({ done, unknown }: { done: boolean; unknown: boolean }) {
  if (done) {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (unknown) {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <path d="M8 12h8" />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function CustomerCard({ p, brainEnabled }: { p: OnboardingProgress; brainEnabled: boolean }) {
  const [st, setSt] = useState<DraftState>(EMPTY);

  async function post(queue: boolean) {
    setSt((s) => ({ ...s, busy: queue ? 'queue' : 'draft', error: null }));
    try {
      const res = await fetch('/api/v2/admin/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: p.customerId, queue }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) {
        setSt((s) => ({ ...s, busy: null, error: data?.error || `Failed (${res.status}).` }));
        return;
      }
      setSt((s) => ({
        ...s,
        busy: null,
        draft: data.draft ?? s.draft,
        queued: queue ? true : s.queued,
        proposalId: queue ? data.proposalId ?? null : s.proposalId,
        persisted: queue ? Boolean(data.persisted) : s.persisted,
        error: null,
      }));
    } catch {
      setSt((s) => ({ ...s, busy: null, error: 'Network error — please retry.' }));
    }
  }

  const stCls = stageClass(p.stage);

  return (
    <div className="v2-card v2-onb-card">
      {/* Header — name, tier, stage, days */}
      <div className="v2-onb-head">
        <div>
          <div className="v2-onb-name">{p.name}</div>
          <div className="v2-onb-meta">
            <span className="v2-onb-tier">{p.tierLabel}</span>
            {p.email && <span className="v2-onb-email">{p.email}</span>}
            {p.daysSinceSignup !== null && (
              <span className="v2-onb-days">
                {p.daysSinceSignup === 0 ? 'signed up today' : `${p.daysSinceSignup}d since signup`}
              </span>
            )}
          </div>
        </div>
        <span className={`v2-pill ${stCls} v2-onb-stage`}>{STAGE_LABEL[p.stage]}</span>
      </div>

      {/* Progress bar */}
      <div className="v2-onb-prog">
        <div className="v2-onb-prog-top">
          <span className="v2-onb-prog-lbl">First success</span>
          <span className="v2-onb-prog-pct">{p.firstSuccessPct}%</span>
        </div>
        <div className="v2-onb-bar">
          <div
            className={`v2-onb-bar-fill s-${stCls}`}
            style={{ width: `${p.firstSuccessPct}%` }}
          />
        </div>
        <div className="v2-onb-prog-sub">
          {p.doneCount}/{p.totalCount} milestones complete
        </div>
      </div>

      {/* Milestone checklist */}
      <ul className="v2-onb-miles">
        {p.milestones.map((m) => (
          <li
            key={m.key}
            className={`v2-onb-mile${m.done ? ' done' : ''}${m.unknown ? ' unknown' : ''}`}
            title={m.hint}
          >
            <span className="v2-onb-mile-ic">
              <CheckIcon done={m.done} unknown={m.unknown} />
            </span>
            <span className="v2-onb-mile-lbl">{m.label}</span>
            {m.unknown && <span className="v2-onb-mile-unk">no data</span>}
          </li>
        ))}
      </ul>

      {/* Unused feature chips */}
      <div className="v2-onb-feat">
        <div className="v2-onb-feat-h">
          Unused on their plan
          <span className="v2-onb-feat-ct">{p.unusedFeatures.length}</span>
        </div>
        {p.unusedFeatures.length === 0 ? (
          <div className="v2-onb-feat-none">All headline features tried 🎉</div>
        ) : (
          <div className="v2-onb-chips">
            {p.unusedFeatures.map((f, i) => (
              <span
                key={f.key}
                className={`v2-onb-chip${i === 0 ? ' top' : ''}`}
                title={f.description}
              >
                {f.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Draft nudge flow */}
      <div className="v2-onb-actions">
        <button
          type="button"
          className="v2-btn ghost v2-onb-draft"
          onClick={() => post(false)}
          disabled={st.busy !== null}
        >
          {st.busy === 'draft' ? 'Drafting…' : st.draft ? 'Re-draft nudge' : 'Draft nudge'}
        </button>
        {!brainEnabled && (
          <span className="v2-onb-hint">Template · enable Brain to personalise</span>
        )}
      </div>

      {st.error && <div className="v2-onb-err">{st.error}</div>}

      {st.draft && (
        <div className="v2-onb-preview">
          <div className="v2-onb-preview-h">
            <span>Draft nudge</span>
            {st.draft.personalised ? (
              <span className="v2-pill ok v2-onb-tag">AI-personalised</span>
            ) : (
              <span className="v2-pill info v2-onb-tag">Template</span>
            )}
          </div>
          <div className="v2-onb-preview-subj">{st.draft.subject}</div>
          <pre className="v2-onb-preview-body">{st.draft.body}</pre>

          {st.queued ? (
            <div className="v2-onb-queued">
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Queued for approval — nothing sends until a human approves.{' '}
              <Link href="/v2/hermes/approvals" className="v2-onb-link">
                Open approvals
              </Link>
              {!st.persisted && (
                <span className="v2-onb-queued-note"> (no DB here — persists in prod)</span>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="v2-btn v2-onb-queue"
              onClick={() => post(true)}
              disabled={st.busy !== null}
            >
              {st.busy === 'queue' ? 'Queueing…' : 'Queue for approval'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function OnboardingBoard({
  customers,
  brainEnabled,
}: {
  customers: OnboardingProgress[];
  brainEnabled: boolean;
}) {
  if (customers.length === 0) {
    return (
      <div className="v2-card v2-onb-empty">No recent customers to onboard.</div>
    );
  }
  return (
    <div className="v2-onb-grid">
      {customers.map((p) => (
        <CustomerCard key={p.customerId} p={p} brainEnabled={brainEnabled} />
      ))}
    </div>
  );
}
