'use client';

// Autonomy MATRIX — the governance console's primary control. One row per
// (persona, tool); each cell is a dial (auto | gated | draft_only) defaulting to
// the RESOLVED value the Brain would use (DB override ?? code default). A badge
// marks whether that value is a code default or a DB override. Flipping a dial
// and saving persists to hermes.autonomy_config via the P1 autonomy API, so the
// Brain gates that tool differently with no redeploy (resolveAutonomy reads the
// same store).
import { useEffect, useMemo, useState } from 'react';

type Mode = 'auto' | 'gated' | 'draft_only';

type MatrixCell = {
  persona: string;
  tool: string;
  defaultMode: Mode;
  dbMode: Mode | null;
  mode: Mode;
  source: 'code' | 'db';
};
type PersonaMeta = { id: string; label: string };
type Payload = { matrix?: MatrixCell[]; personas?: PersonaMeta[]; modes?: Mode[] };
type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

const MODE_LABEL: Record<Mode, string> = {
  auto: 'Auto',
  gated: 'Gated · needs approval',
  draft_only: 'Draft only',
};

export default function GovernanceAutonomyMatrix() {
  const [loaded, setLoaded] = useState(false);
  const [cells, setCells] = useState<MatrixCell[]>([]);
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [modes, setModes] = useState<Mode[]>(['auto', 'gated', 'draft_only']);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  async function load() {
    try {
      const res = await fetch('/api/v2/settings/hermes/autonomy');
      const data = (await res.json()) as Payload;
      setCells(Array.isArray(data.matrix) ? data.matrix : []);
      setPersonas(Array.isArray(data.personas) ? data.personas : []);
      if (Array.isArray(data.modes) && data.modes.length) setModes(data.modes);
    } catch {
      setCells([]);
    } finally {
      setLoaded(true);
      setDirty(new Set());
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const labelFor = useMemo(() => {
    const m = new Map(personas.map((p) => [p.id, p.label]));
    return (id: string) => m.get(id) ?? id;
  }, [personas]);

  // Group cells by persona, preserving the server's ordering.
  const byPersona = useMemo(() => {
    const m = new Map<string, MatrixCell[]>();
    for (const c of cells) {
      const list = m.get(c.persona) ?? [];
      list.push(c);
      m.set(c.persona, list);
    }
    return Array.from(m.entries());
  }, [cells]);

  function setMode(persona: string, tool: string, mode: Mode) {
    const key = `${persona}:${tool}`;
    setCells((prev) =>
      prev.map((c) =>
        c.persona === persona && c.tool === tool
          ? { ...c, mode, dbMode: mode, source: 'db' }
          : c,
      ),
    );
    setDirty((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setSave({ kind: 'idle' });
  }

  async function handleSave() {
    // Only persist the cells the operator actually touched.
    const changed = cells.filter((c) => dirty.has(`${c.persona}:${c.tool}`));
    if (changed.length === 0) {
      setSave({ kind: 'saved' });
      return;
    }
    setSave({ kind: 'saving' });
    try {
      const res = await fetch('/api/v2/settings/hermes/autonomy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tools: changed.map((c) => ({ persona: c.persona, tool: c.tool, mode: c.mode })),
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

  if (!loaded) return <div className="v2-hp-loading">Loading matrix…</div>;
  if (cells.length === 0) {
    return <div className="v2-hp-loading">No personas configured.</div>;
  }

  return (
    <div className="v2-set-hbody">
      {byPersona.map(([persona, rows]) => (
        <div key={persona} className="v2-gov-persona">
          <div className="v2-set-label v2-gov-persona-h">{labelFor(persona)}</div>
          <table className="v2-table v2-gov-matrix">
            <thead>
              <tr>
                <th>Tool / action</th>
                <th>Autonomy</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.persona}:${c.tool}`}>
                  <td className="v2-gov-tool">{c.tool}</td>
                  <td>
                    <select
                      className="v2-hp-input"
                      value={c.mode}
                      onChange={(e) => setMode(c.persona, c.tool, e.target.value as Mode)}
                      style={{ maxWidth: 240 }}
                    >
                      {modes.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m] ?? m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {c.source === 'db' ? (
                      <span
                        className="v2-pill info"
                        title={`Overridden in the DB (code default: ${MODE_LABEL[c.defaultMode]})`}
                      >
                        DB override
                      </span>
                    ) : (
                      <span className="v2-pill" title="Value comes from the code default">
                        Code default
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="v2-hp-foot" style={{ marginTop: 16 }}>
        <button
          className="v2-btn"
          onClick={() => void handleSave()}
          disabled={save.kind === 'saving' || dirty.size === 0}
        >
          {save.kind === 'saving'
            ? 'Saving…'
            : dirty.size > 0
              ? `Save ${dirty.size} change${dirty.size === 1 ? '' : 's'}`
              : 'Save changes'}
        </button>
        {save.kind === 'saved' ? <span className="v2-hp-status saved">Saved ✓</span> : null}
        {save.kind === 'error' ? (
          <span className="v2-hp-status error">{save.msg ?? 'Save failed.'}</span>
        ) : null}
      </div>
    </div>
  );
}
