'use client';

// Autonomy dials — the governance keystone's UI. Loads the real per-(persona,
// tool) modes + thresholds from /api/v2/settings/hermes/autonomy and persists
// edits. Flipping a dial here changes whether the Brain gates that tool (the
// graph reads the same store via resolveAutonomy) — no redeploy.
import { useEffect, useMemo, useState } from 'react';

type Mode = 'auto' | 'gated' | 'draft_only';
type ToolRow = { persona: string; tool: string; mode: Mode };
type Threshold = { key: string; label: string; value: string };
type Payload = { tools: ToolRow[]; thresholds: Threshold[]; modes: Mode[] };
type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

const MODE_LABEL: Record<Mode, string> = {
  auto: 'Auto',
  gated: 'Gated · needs approval',
  draft_only: 'Draft only',
};

export default function HermesAutonomyDials() {
  const [loaded, setLoaded] = useState(false);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [modes, setModes] = useState<Mode[]>(['auto', 'gated', 'draft_only']);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  async function load() {
    try {
      const res = await fetch('/api/v2/settings/hermes/autonomy');
      const data = (await res.json()) as Payload;
      setTools(Array.isArray(data.tools) ? data.tools : []);
      setThresholds(Array.isArray(data.thresholds) ? data.thresholds : []);
      if (Array.isArray(data.modes) && data.modes.length) setModes(data.modes);
    } catch {
      setTools([]);
      setThresholds([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Group tool rows by persona for a readable matrix.
  const byPersona = useMemo(() => {
    const m = new Map<string, ToolRow[]>();
    for (const r of tools) {
      const list = m.get(r.persona) ?? [];
      list.push(r);
      m.set(r.persona, list);
    }
    return Array.from(m.entries());
  }, [tools]);

  function setMode(persona: string, tool: string, mode: Mode) {
    setTools((prev) =>
      prev.map((r) => (r.persona === persona && r.tool === tool ? { ...r, mode } : r)),
    );
    setSave({ kind: 'idle' });
  }

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
          tools: tools.map((t) => ({ persona: t.persona, tool: t.tool, mode: t.mode })),
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

  if (!loaded) return <div className="v2-hp-loading">Loading dials…</div>;

  return (
    <div className="v2-set-hbody">
      {byPersona.map(([persona, rows]) => (
        <div key={persona} style={{ marginBottom: 18 }}>
          <div className="v2-set-label" style={{ textTransform: 'capitalize', marginBottom: 6 }}>
            {persona}
          </div>
          <table className="v2-table">
            <thead>
              <tr>
                <th>Tool / action</th>
                <th>Autonomy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.persona}:${r.tool}`}>
                  <td>{r.tool}</td>
                  <td>
                    <select
                      className="v2-hp-input"
                      value={r.mode}
                      onChange={(e) => setMode(r.persona, r.tool, e.target.value as Mode)}
                      style={{ maxWidth: 240 }}
                    >
                      {modes.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m] ?? m}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="v2-set-label" style={{ marginTop: 6, marginBottom: 8 }}>
        Approval thresholds
      </div>
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

      <div className="v2-hp-foot" style={{ marginTop: 16 }}>
        <button className="v2-btn" onClick={() => void handleSave()} disabled={save.kind === 'saving'}>
          {save.kind === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {save.kind === 'saved' ? <span className="v2-hp-status saved">Saved ✓</span> : null}
        {save.kind === 'error' ? (
          <span className="v2-hp-status error">{save.msg ?? 'Save failed.'}</span>
        ) : null}
      </div>
    </div>
  );
}
