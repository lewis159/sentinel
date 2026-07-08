'use client';

// Live approval queue for the v2 Hermes oversight page. Replaces the old static
// mock: it reads REAL persisted proposals awaiting review from the sibling-built
// proposals API and lets the operator approve-and-send or dismiss each one.
//   - GET  /api/hermes/proposals?status=pending → { proposals, live }
//   - POST /api/hermes/proposals/[id] { action }  → { ok, error? }
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

type RowState = { busy: 'approve' | 'dismiss' | null; error: string | null };

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
  // so polling is automatic — do not set an interval here.
  const { data, error, mutate } = useSWR<ProposalsResp>(
    '/api/hermes/proposals?status=pending',
    fetcher,
  );

  // Per-row acting/error state, keyed by proposal id.
  const [rows, setRows] = useState<Record<string, RowState>>({});

  function setRow(id: string, next: RowState) {
    setRows((prev) => ({ ...prev, [id]: next }));
  }

  async function act(id: string, action: 'approve' | 'dismiss') {
    setRow(id, { busy: action, error: null });
    try {
      const res = await fetch(`/api/hermes/proposals/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
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

      // Success — clear row state and revalidate so the handled item drops out.
      setRow(id, { busy: null, error: null });
      await mutate();
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
        const conf = clampPct(p.proposal.confidence);
        const label = p.proposal.classification || p.summary || p.title;
        return (
          <div
            key={p.id}
            className="v2-apq-row"
            style={{ ['--tint' as string]: tintFor(p) } as React.CSSProperties}
          >
            <div className="v2-apq-body">
              <div className="v2-apq-title">{p.title}</div>
              <div className="v2-apq-meta">
                <span className="v2-apq-dep">
                  {p.agent} · {p.kind}
                </span>
                <Link href={`/v2/support/${p.ref}`} className="v2-apq-target">
                  {p.ref}
                </Link>
                {label && (
                  <>
                    <span className="v2-apq-dot">·</span>
                    <span className="v2-apq-guard">{label}</span>
                  </>
                )}
              </div>
              {p.proposal.draft && (
                <div className="v2-apq-draft">{preview(p.proposal.draft)}</div>
              )}
              {st.error && <div className="v2-apq-rowerr">{st.error}</div>}
            </div>

            <div className="v2-apq-right">
              <div className="v2-apq-conf">
                {conf}%<small>confidence</small>
              </div>
              <button
                type="button"
                className="v2-btn v2-apq-approve"
                onClick={() => act(p.id, 'approve')}
                disabled={st.busy !== null}
              >
                {st.busy === 'approve' ? 'Sending…' : 'Approve & send'}
              </button>
              <button
                type="button"
                className="v2-apq-deny"
                aria-label="Dismiss"
                onClick={() => act(p.id, 'dismiss')}
                disabled={st.busy !== null}
                title="Dismiss"
              >
                {st.busy === 'dismiss' ? '…' : '×'}
              </button>
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
