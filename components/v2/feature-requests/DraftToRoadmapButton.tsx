'use client';

// The "draft to roadmap" affordance on a feature-request theme card.
//
// Posts the theme to POST /api/v2/admin/feature-requests, which creates a DRAFT
// proposal on the Hermes proposals spine (Approvals queue). It does NOT write the
// roadmap — a human approves the draft and creates the roadmap item. This button
// only appears when the Brain refined the theme (i.e. there's a suggested title).

import { useState } from 'react';

export type DraftPayload = {
  label: string;
  suggestedRoadmapTitle?: string;
  summary?: string;
  keywords?: string[];
  count?: number;
  exampleRefs?: string[];
};

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function DraftToRoadmapButton({ payload }: { payload: DraftPayload }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string>('');

  async function draft() {
    setPhase('working');
    setNote('');
    try {
      const res = await fetch('/api/v2/admin/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; persisted?: boolean }
        | null;
      if (!res.ok || !body?.ok) {
        setPhase('error');
        setNote(body?.error || `Failed (${res.status})`);
        return;
      }
      setPhase('done');
      setNote(
        body.persisted
          ? 'Drafted to the approval queue — approve there to proceed.'
          : 'Draft accepted (no database in this environment).',
      );
    } catch {
      setPhase('error');
      setNote('Network error — please retry.');
    }
  }

  if (phase === 'done') {
    return <span className="v2-fr-drafted">✓ Drafted for review</span>;
  }

  return (
    <div className="v2-fr-draft-wrap">
      <button
        type="button"
        className="v2-btn v2-fr-draft-btn"
        onClick={draft}
        disabled={phase === 'working'}
        title="Create a draft roadmap proposal for a human to approve"
      >
        {phase === 'working' ? 'Drafting…' : 'Draft to roadmap'}
      </button>
      {phase === 'error' && note && <span className="v2-fr-draft-err">{note}</span>}
    </div>
  );
}
