'use client';

// Escalation configuration — surfaces what the support-roles work (lib/support/
// roles.ts + migration 16) actually implements, and lets the operator edit the
// governance THRESHOLDS that drive it.
//
// Two parts:
//  1. The escalation LADDER (read-only): the rungs L1 → L2 → human and which
//     actions ALWAYS route to the human approval gate. These are code-enforced in
//     lib/support/roles.ts (authorize / requiresHumanGate) — we surface them so
//     the operator can SEE the rule-based engine, not re-invent it.
//  2. The governance THRESHOLDS (editable): the numeric limits (auto-refund cap,
//     refund cap / 30d, founder approval SLA, …) stored in hermes.autonomy_thresholds.
//     Saving persists via the P1 autonomy API's thresholds path — no new engine.
import { useEffect, useState } from 'react';
import {
  ESCALATION_LADDER,
  LEVEL_LABEL,
  HUMAN_GATE_ACTIONS,
  type EscalationLevel,
} from '@/lib/support/roles';

type Threshold = { key: string; label: string; value: string };
type Payload = { thresholds?: Threshold[] };
type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

export default function GovernanceEscalation() {
  const [loaded, setLoaded] = useState(false);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  async function load() {
    try {
      const res = await fetch('/api/v2/settings/hermes/autonomy');
      const data = (await res.json()) as Payload;
      setThresholds(Array.isArray(data.thresholds) ? data.thresholds : []);
    } catch {
      setThresholds([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setThreshold(key: string, value: string) {
    setThresholds((prev) => prev.map((t) => (t.key === key ? { ...t, value } : t)));
    setSave({ kind: 'idle' });
  }

  async function handleSave() {
    setSave({ kind: 'saving' });
    try {
      const res = await fetch('/api/v2/settings/hermes/autonomy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thresholds: thresholds.map((t) => ({ key: t.key, value: t.value })),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setSave({ kind: 'error', msg: data.error ?? 'Save failed.' });
        return;
      }
      setSave({ kind: 'saved' });
      await load();
    } catch {
      setSave({ kind: 'error', msg: 'Network error while saving.' });
    }
  }

  return (
    <div className="v2-set-hbody">
      {/* 1 — Escalation ladder (read-only, code-enforced) */}
      <div className="v2-set-label" style={{ marginBottom: 8 }}>
        Escalation ladder
      </div>
      <div className="v2-gov-ladder">
        {ESCALATION_LADDER.map((lvl: EscalationLevel, i: number) => (
          <div key={lvl} className="v2-gov-rung">
            <span className="v2-pill info">{LEVEL_LABEL[lvl]}</span>
            {i < ESCALATION_LADDER.length - 1 ? <span className="v2-gov-arr">→</span> : null}
          </div>
        ))}
      </div>
      <div className="v2-set-mini" style={{ marginTop: 8 }}>
        Enforced in code (lib/support/roles.ts). These actions ALWAYS route to the human
        approval gate — no support role executes them directly:
      </div>
      <div className="v2-gov-gate">
        {HUMAN_GATE_ACTIONS.map((a) => (
          <span key={a} className="v2-pill">
            {a}
          </span>
        ))}
      </div>

      {/* 2 — Governance thresholds (editable → hermes.autonomy_thresholds) */}
      <div className="v2-set-label" style={{ marginTop: 18, marginBottom: 8 }}>
        Governance thresholds
      </div>
      {!loaded ? (
        <div className="v2-hp-loading">Loading thresholds…</div>
      ) : thresholds.length === 0 ? (
        <div className="v2-gov-empty">No thresholds configured.</div>
      ) : (
        <div className="v2-set-thresh">
          {thresholds.map((t) => (
            <div key={t.key} className="v2-set-field">
              <span className="v2-set-label">{t.label}</span>
              <input
                className="v2-hp-input"
                type="text"
                value={t.value}
                onChange={(e) => setThreshold(t.key, e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      )}

      <div className="v2-hp-foot" style={{ marginTop: 16 }}>
        <button
          className="v2-btn"
          onClick={() => void handleSave()}
          disabled={save.kind === 'saving' || thresholds.length === 0}
        >
          {save.kind === 'saving' ? 'Saving…' : 'Save thresholds'}
        </button>
        {save.kind === 'saved' ? <span className="v2-hp-status saved">Saved ✓</span> : null}
        {save.kind === 'error' ? (
          <span className="v2-hp-status error">{save.msg ?? 'Save failed.'}</span>
        ) : null}
      </div>
    </div>
  );
}
