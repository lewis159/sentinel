'use client';

// Agent Builder — the admin surface that drafts a NEW Hermes persona from a plain-
// English brief. Flow: write a brief → "Generate draft" (POST generate) → review +
// edit the drafted persona (label / SOUL / read-only tools / section) → "Save
// draft" (POST save, status='draft') → "Approve" (POST approve, flips to
// 'approved'). An approved draft is STILL NOT LIVE — activation is a manual code
// step, called out prominently below. Namespaced v2-ab-*; colours from shell tokens.

import { useEffect, useState } from 'react';

type Section = 'support' | 'operations' | 'security';
type DraftStatus = 'draft' | 'approved';

type Draft = {
  id: string;
  label: string;
  systemPrompt: string;
  allowedTools: string[];
  section: Section;
  autonomy: Record<string, string>;
  advisory?: boolean;
};

type DraftRecord = Draft & {
  status: DraftStatus;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

type ListResp = { drafts: DraftRecord[]; tools: string[]; sections: Section[] };

const SECTION_LABELS: Record<Section, string> = {
  support: 'Support',
  operations: 'Operations',
  security: 'Security',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function AgentBuilder() {
  const [tools, setTools] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [brief, setBrief] = useState('');
  const [briefSection, setBriefSection] = useState<Section>('operations');
  const [working, setWorking] = useState<Draft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/v2/admin/agent-builder');
      const data = (await res.json()) as ListResp;
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setTools(Array.isArray(data.tools) ? data.tools : []);
    } catch {
      /* leave state as-is */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleGenerate() {
    if (!brief.trim()) return;
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v2/admin/agent-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', brief, section: briefSection }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice({ kind: 'err', msg: data?.error ?? `Generate failed (HTTP ${res.status})` });
        return;
      }
      setWorking(data.draft as Draft);
      if (data.modelError) {
        setNotice({ kind: 'ok', msg: `Deterministic skeleton (model enrichment skipped: ${data.modelError}).` });
      }
    } catch {
      setNotice({ kind: 'err', msg: 'Network error while generating the draft.' });
    } finally {
      setGenerating(false);
    }
  }

  function toggleTool(name: string) {
    if (!working) return;
    const has = working.allowedTools.includes(name);
    setWorking({
      ...working,
      allowedTools: has
        ? working.allowedTools.filter((t) => t !== name)
        : [...working.allowedTools, name],
    });
  }

  async function handleSave() {
    if (!working) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v2/admin/agent-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', draft: working }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice({ kind: 'err', msg: data?.error ?? `Save failed (HTTP ${res.status})` });
        return;
      }
      setNotice({ kind: 'ok', msg: `Draft "${data.draft.id}" saved (status: draft).` });
      setWorking(null);
      await refresh();
    } catch {
      setNotice({ kind: 'err', msg: 'Network error while saving the draft.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string) {
    setNotice(null);
    try {
      const res = await fetch('/api/v2/admin/agent-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNotice({ kind: 'err', msg: data?.error ?? `Approve failed (HTTP ${res.status})` });
        return;
      }
      setNotice({
        kind: 'ok',
        msg: `Draft "${id}" approved — NOT live. Activation is a separate, manual code step.`,
      });
      await refresh();
    } catch {
      setNotice({ kind: 'err', msg: 'Network error while approving the draft.' });
    }
  }

  return (
    <div className="v2-ab">
      {/* Safety banner — the single most important thing on the page */}
      <div className="v2-ab-safety">
        <span className="v2-pill high v2-ab-pill">Draft-only</span>
        <span>
          New personas are created as <strong>drafts</strong> and default to{' '}
          <strong>advisory / read-only</strong>. Approving a draft <strong>does not make it live</strong>{' '}
          or executable — turning an approved draft into an active persona is a separate,{' '}
          <strong>deliberate, manual code/registration step</strong>. The builder never mutates the
          running persona set.
        </span>
      </div>

      {notice ? (
        <div className={notice.kind === 'ok' ? 'v2-ab-note' : 'v2-ab-err'}>{notice.msg}</div>
      ) : null}

      {/* Brief → generate */}
      <div className="v2-card v2-ab-card">
        <div className="v2-card-h">
          <div className="v2-set-ch">
            <h3>Describe the agent</h3>
            <span className="st">
              Describe the new agent/persona in plain English. The builder drafts a persona
              definition — a SOUL, a suggested read-only tool set, a section — for you to review.
            </span>
          </div>
        </div>

        <textarea
          className="v2-ab-textarea"
          placeholder="e.g. An agent that reviews open incidents each morning and summarises what changed overnight, flags anything at risk, and recommends what to look at first. Read-only."
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
        />
        <div className="v2-ab-briefrow">
          <label className="v2-ab-field">
            <span className="v2-ab-label">Section</span>
            <select
              className="v2-ab-select"
              value={briefSection}
              onChange={(e) => setBriefSection(e.target.value as Section)}
            >
              {(['support', 'operations', 'security'] as Section[]).map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="v2-btn"
            onClick={() => void handleGenerate()}
            disabled={generating || !brief.trim()}
          >
            {generating ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      </div>

      {/* Editable drafted persona */}
      {working ? (
        <div className="v2-card v2-ab-card">
          <div className="v2-card-h">
            <div className="v2-set-ch">
              <h3>Review the drafted persona</h3>
              <span className="st">
                Edit anything below, then save it as a draft. Only read-only tools can be selected —
                gated / side-effecting tools are never offered.
              </span>
            </div>
            {working.advisory ? <span className="v2-pill ok v2-ab-pill">advisory · read-only</span> : null}
          </div>

          <div className="v2-ab-grid">
            <label className="v2-ab-field">
              <span className="v2-ab-label">Persona id</span>
              <input className="v2-ab-input" value={working.id} readOnly title="derived from the brief" />
            </label>
            <label className="v2-ab-field">
              <span className="v2-ab-label">Label</span>
              <input
                className="v2-ab-input"
                value={working.label}
                onChange={(e) => setWorking({ ...working, label: e.target.value })}
              />
            </label>
            <label className="v2-ab-field">
              <span className="v2-ab-label">Section</span>
              <select
                className="v2-ab-select"
                value={working.section}
                onChange={(e) => setWorking({ ...working, section: e.target.value as Section })}
              >
                {(['support', 'operations', 'security'] as Section[]).map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="v2-ab-field">
            <span className="v2-ab-label">SOUL — system prompt</span>
            <textarea
              className="v2-ab-textarea mono"
              value={working.systemPrompt}
              onChange={(e) => setWorking({ ...working, systemPrompt: e.target.value })}
              rows={14}
            />
          </label>

          <div className="v2-ab-field">
            <span className="v2-ab-label">Allowed tools (read-only only)</span>
            <div className="v2-ab-tools">
              {tools.length === 0 ? (
                <span className="v2-ab-muted">No read-only tools in the registry.</span>
              ) : (
                tools.map((t) => (
                  <label key={t} className="v2-ab-tool">
                    <input
                      type="checkbox"
                      checked={working.allowedTools.includes(t)}
                      onChange={() => toggleTool(t)}
                    />
                    <code>{t}</code>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="v2-ab-actions">
            <button className="v2-btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button className="v2-btn ghost" onClick={() => setWorking(null)} disabled={saving}>
              Discard
            </button>
            <span className="v2-ab-hint">
              Saving stores this as a <strong>draft</strong> — it does not go live.
            </span>
          </div>
        </div>
      ) : null}

      {/* Existing drafts */}
      <div className="v2-card v2-ab-card">
        <div className="v2-card-h">
          <div className="v2-set-ch">
            <h3>Persona drafts</h3>
            <span className="st">
              Every drafted persona and its review status. Approving is a human gate on the draft —
              it records the approval but never activates the persona.
            </span>
          </div>
        </div>

        <div className="v2-ab-rows">
          {drafts.length === 0 ? (
            <div className="v2-ab-empty">No persona drafts yet.</div>
          ) : (
            drafts.map((d) => (
              <div key={d.id} className="v2-ab-row">
                <span className={`v2-pill ${d.status === 'approved' ? 'ok' : 'info'} v2-ab-pill`}>
                  {d.status}
                </span>
                <div className="v2-ab-rowbody">
                  <div className="v2-ab-rowtop">
                    <span className="v2-ab-rowlabel">{d.label}</span>
                    <code className="v2-ab-rowid">{d.id}</code>
                    {d.advisory ? <span className="v2-ab-tag">advisory</span> : null}
                    <span className="v2-ab-tag">{SECTION_LABELS[d.section] ?? d.section}</span>
                  </div>
                  <div className="v2-ab-rowmeta">
                    tools: {d.allowedTools.length ? d.allowedTools.join(', ') : 'none (read-only)'} ·
                    created {fmtTime(d.createdAt)}
                    {d.status === 'approved' ? ` · approved ${fmtTime(d.approvedAt)}` : ''}
                  </div>
                </div>
                {d.status === 'draft' ? (
                  <button className="v2-btn" onClick={() => void handleApprove(d.id)}>
                    Approve
                  </button>
                ) : (
                  <span className="v2-ab-notlive" title="activation is a manual code step">
                    approved ≠ live
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
