'use client';

// Live SALES / LEAD-QUALIFICATION pipeline for the v2 Hermes console.
// Reads scored leads (GET /api/v2/admin/leads), ranks them hot → warm → cold,
// and lets the operator draft a GROUNDED pre-sale reply for any lead. The draft
// is DRAFT-ONLY: it lands in the Approvals queue (POST /api/v2/admin/leads) and
// is never sent from here. Namespaced v2-leads-* so nothing leaks.

import { useState } from 'react';
import useSWR from 'swr';

type Assessment = {
  score: number;
  tier: 'hot' | 'warm' | 'cold';
  reasons: string[];
};
type LeadRecord = {
  ref: string;
  name: string | null;
  email: string | null;
  company: string | null;
  message: string;
  source: string;
  status: string;
  age: string;
  flagged: boolean;
  assessment: Assessment;
};
type LeadsResp = { leads: LeadRecord[]; live: boolean };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

type RowState = { busy: boolean; draft: string | null; error: string | null };

function tierClass(tier: string): string {
  return tier === 'hot' ? 'hot' : tier === 'warm' ? 'warm' : 'cold';
}

export default function LeadsPipeline() {
  const { data, error } = useSWR<LeadsResp>('/api/v2/admin/leads', fetcher);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  function setRow(ref: string, next: RowState) {
    setRows((prev) => ({ ...prev, [ref]: next }));
  }

  async function draftReply(ref: string) {
    setRow(ref, { busy: true, draft: null, error: null });
    try {
      const res = await fetch('/api/v2/admin/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; draft?: string; error?: string; persisted?: boolean }
        | null;
      if (!res.ok || !body?.ok) {
        setRow(ref, { busy: false, draft: null, error: body?.error || `Failed (${res.status}).` });
        return;
      }
      setRow(ref, { busy: false, draft: body.draft ?? '(no draft)', error: null });
    } catch {
      setRow(ref, { busy: false, draft: null, error: 'Network error — please retry.' });
    }
  }

  if (!data && !error) {
    return (
      <div className="v2-card v2-leads-card">
        <div className="v2-leads-empty">Loading leads…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="v2-card v2-leads-card">
        <div className="v2-leads-empty">Couldn&apos;t load leads.</div>
      </div>
    );
  }

  const leads = data?.leads ?? [];
  if (leads.length === 0) {
    return (
      <div className="v2-card v2-leads-card">
        <div className="v2-leads-empty">No leads captured yet.</div>
        {data?.live === false && (
          <div className="v2-leads-note">
            No database in this environment — leads persist in production.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="v2-card v2-leads-card">
      {leads.map((lead) => {
        const st = rows[lead.ref] ?? { busy: false, draft: null, error: null };
        const t = tierClass(lead.assessment.tier);
        return (
          <div key={lead.ref} className={`v2-leads-row tier-${t}`}>
            <div className="v2-leads-main">
              <div className="v2-leads-head">
                <span className={`v2-leads-tier ${t}`}>{lead.assessment.tier}</span>
                <span className="v2-leads-score">{lead.assessment.score}<small>/100</small></span>
                {lead.flagged && <span className="v2-leads-flag">🔥 hot lead</span>}
                <span className="v2-leads-ref">{lead.ref}</span>
              </div>

              <div className="v2-leads-who">
                {lead.company || lead.name || 'Unknown'}
                {lead.email && <span className="v2-leads-email"> · {lead.email}</span>}
                <span className="v2-leads-src"> · via {lead.source}</span>
              </div>

              <div className="v2-leads-msg">{lead.message || '(no message)'}</div>

              {lead.assessment.reasons.length > 0 && (
                <ul className="v2-leads-reasons">
                  {lead.assessment.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}

              {st.error && <div className="v2-leads-err">{st.error}</div>}
              {st.draft && (
                <div className="v2-leads-draft">
                  <div className="v2-leads-draft-cap">Drafted reply — sent to approval queue (gated)</div>
                  <div className="v2-leads-draft-body">{st.draft}</div>
                </div>
              )}
            </div>

            <div className="v2-leads-right">
              <button
                type="button"
                className="v2-btn v2-leads-draftbtn"
                onClick={() => draftReply(lead.ref)}
                disabled={st.busy}
              >
                {st.busy ? 'Drafting…' : 'Draft reply'}
              </button>
            </div>
          </div>
        );
      })}

      {data?.live === false && (
        <div className="v2-leads-note">
          No database in this environment — leads persist in production.
        </div>
      )}
    </div>
  );
}
