'use client';

// Budget caps editor — per (persona, tool, scope) spend caps in ops.hermes_budgets,
// the same caps lib/hermes/budget.ts meters the Brain's tool spend against. Shows
// each cap in MAJOR units (£) with its rolling window and best-effort current
// spend, and lets an operator edit an existing cap or add a new one. Saving POSTs
// to /api/v2/settings/hermes/budgets (major→minor conversion happens server-side),
// so changing a cap changes what the Brain will let a persona spend — no redeploy.
import { useEffect, useMemo, useState } from 'react';

type PersonaMeta = { id: string; label: string };
type WindowOpt = { key: string; label: string; seconds: number };
type Cap = {
  persona: string;
  tool: string;
  scope: string;
  capMinor: number;
  capMajor: number;
  windowSeconds: number;
  windowLabel: string;
  spentMinor: number;
  remainingMinor: number;
  updatedAt: string | null;
};
type Payload = { caps?: Cap[]; personas?: PersonaMeta[]; windows?: WindowOpt[] };
type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;

export default function GovernanceBudgetCaps() {
  const [loaded, setLoaded] = useState(false);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [windows, setWindows] = useState<WindowOpt[]>([
    { key: 'daily', label: 'Daily', seconds: 86400 },
    { key: 'weekly', label: 'Weekly', seconds: 604800 },
  ]);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  // New-cap form.
  const [newPersona, setNewPersona] = useState('');
  const [newTool, setNewTool] = useState('*');
  const [newCap, setNewCap] = useState('');
  const [newWindow, setNewWindow] = useState(86400);

  async function load() {
    try {
      const res = await fetch('/api/v2/settings/hermes/budgets');
      const data = (await res.json()) as Payload;
      setCaps(Array.isArray(data.caps) ? data.caps : []);
      setPersonas(Array.isArray(data.personas) ? data.personas : []);
      if (Array.isArray(data.windows) && data.windows.length) setWindows(data.windows);
    } catch {
      setCaps([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const labelFor = useMemo(() => {
    const m = new Map(personas.map((p) => [p.id, p.label]));
    return (id: string) => m.get(id) ?? id;
  }, [personas]);

  async function upsert(body: {
    persona: string;
    tool: string;
    scope: string;
    capMajor: number;
    windowSeconds: number;
  }) {
    setSave({ kind: 'saving' });
    try {
      const res = await fetch('/api/v2/settings/hermes/budgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setSave({ kind: 'error', msg: data.error ?? 'Save failed.' });
        return false;
      }
      setSave({ kind: 'saved' });
      await load();
      return true;
    } catch {
      setSave({ kind: 'error', msg: 'Network error while saving.' });
      return false;
    }
  }

  // Inline edit of an existing cap's amount/window.
  function editCap(idx: number, patch: Partial<Cap>) {
    setCaps((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    setSave({ kind: 'idle' });
  }

  async function saveExisting(c: Cap) {
    await upsert({
      persona: c.persona,
      tool: c.tool,
      scope: c.scope,
      capMajor: Number(c.capMajor) || 0,
      windowSeconds: c.windowSeconds,
    });
  }

  async function addNew() {
    if (!newPersona) {
      setSave({ kind: 'error', msg: 'Pick a persona.' });
      return;
    }
    const capMajor = Number(newCap);
    if (!Number.isFinite(capMajor) || capMajor < 0) {
      setSave({ kind: 'error', msg: 'Enter a valid cap amount.' });
      return;
    }
    const ok = await upsert({
      persona: newPersona,
      tool: newTool.trim() || '*',
      scope: 'global',
      capMajor,
      windowSeconds: newWindow,
    });
    if (ok) {
      setNewPersona('');
      setNewTool('*');
      setNewCap('');
    }
  }

  if (!loaded) return <div className="v2-hp-loading">Loading caps…</div>;

  return (
    <div className="v2-set-hbody">
      {caps.length === 0 ? (
        <div className="v2-gov-empty">
          No caps configured{' '}
          <span className="v2-set-mini">
            (with no database connected, caps cannot be read or saved).
          </span>
        </div>
      ) : (
        <table className="v2-table v2-gov-budgets">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Tool</th>
              <th>Cap (£)</th>
              <th>Window</th>
              <th>Spent · window</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {caps.map((c, i) => (
              <tr key={`${c.persona}:${c.tool}:${c.scope}`}>
                <td>{labelFor(c.persona)}</td>
                <td className="v2-gov-tool">{c.tool === '*' ? 'All tools' : c.tool}</td>
                <td>
                  <input
                    className="v2-hp-input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={c.capMajor}
                    onChange={(e) => editCap(i, { capMajor: Number(e.target.value) })}
                    style={{ maxWidth: 110 }}
                  />
                </td>
                <td>
                  <select
                    className="v2-hp-input"
                    value={c.windowSeconds}
                    onChange={(e) => editCap(i, { windowSeconds: Number(e.target.value) })}
                    style={{ maxWidth: 130 }}
                  >
                    {windows.map((w) => (
                      <option key={w.key} value={w.seconds}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span title={`${money(c.spentMinor)} spent of ${money(c.capMinor)}`}>
                    {money(c.spentMinor)}{' '}
                    <span className="v2-set-mini">/ {money(c.capMinor)}</span>
                  </span>
                </td>
                <td>
                  <button className="v2-btn" onClick={() => void saveExisting(c)}>
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add a new cap */}
      <div className="v2-gov-addcap">
        <div className="v2-set-label" style={{ marginBottom: 8 }}>
          Add a cap
        </div>
        <div className="v2-gov-addrow">
          <select
            className="v2-hp-input"
            value={newPersona}
            onChange={(e) => setNewPersona(e.target.value)}
          >
            <option value="">Persona…</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="v2-hp-input"
            type="text"
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="Tool (* = all)"
            spellCheck={false}
            autoComplete="off"
            style={{ maxWidth: 160 }}
          />
          <input
            className="v2-hp-input"
            type="number"
            min={0}
            step="0.01"
            value={newCap}
            onChange={(e) => setNewCap(e.target.value)}
            placeholder="Cap £"
            style={{ maxWidth: 110 }}
          />
          <select
            className="v2-hp-input"
            value={newWindow}
            onChange={(e) => setNewWindow(Number(e.target.value))}
            style={{ maxWidth: 130 }}
          >
            {windows.map((w) => (
              <option key={w.key} value={w.seconds}>
                {w.label}
              </option>
            ))}
          </select>
          <button className="v2-btn" onClick={() => void addNew()} disabled={save.kind === 'saving'}>
            Add cap
          </button>
        </div>
      </div>

      <div className="v2-hp-foot" style={{ marginTop: 12 }}>
        {save.kind === 'saving' ? <span className="v2-hp-status">Saving…</span> : null}
        {save.kind === 'saved' ? <span className="v2-hp-status saved">Saved ✓</span> : null}
        {save.kind === 'error' ? (
          <span className="v2-hp-status error">{save.msg ?? 'Save failed.'}</span>
        ) : null}
      </div>
    </div>
  );
}
