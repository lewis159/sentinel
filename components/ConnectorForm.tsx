'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Field = { key: string; label: string; secret?: boolean };

const inputStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 9,
  color: 'var(--text)',
  fontSize: 13,
  width: '100%',
  outline: 'none',
};

export default function ConnectorForm({
  type,
  label,
  fields,
  existing,
}: {
  type: string;
  label: string;
  fields: Field[];
  existing: { name: string; config: any; enabled: boolean } | null;
}) {
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      const cur = existing?.config?.[f.key];
      // Don't prefill secrets (they come back masked) — leave blank, placeholder shows masked state.
      v[f.key] = f.secret ? '' : cur ?? '';
    }
    return v;
  });
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function set(key: string, val: string) {
    setValues((p) => ({ ...p, [key]: val }));
  }

  // Build the config to send. For secret fields left blank, keep the previously saved value.
  function buildConfig() {
    const cfg: Record<string, string> = {};
    for (const f of fields) {
      const entered = values[f.key];
      if (f.secret && !entered) {
        const prev = existing?.config?.[f.key];
        // prev may be masked ('••••xxxx'); if so we cannot re-send it usefully, skip.
        if (prev && !String(prev).startsWith('••••')) cfg[f.key] = prev;
      } else {
        cfg[f.key] = entered ?? '';
      }
    }
    return cfg;
  }

  async function onTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, config: buildConfig() }),
      });
      const data = await res.json();
      if (data.ok) setTestMsg({ ok: true, text: `✓ Connected · ${data.count} rows` });
      else setTestMsg({ ok: false, text: `✗ ${data.error || 'failed'}` });
    } catch (e: any) {
      setTestMsg({ ok: false, text: `✗ ${e?.message || 'failed'}` });
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label, type, config: buildConfig(), enabled }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedMsg('Saved');
        router.refresh();
      } else {
        setSavedMsg(data.error || 'Save failed');
      }
    } catch (e: any) {
      setSavedMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(null), 2500);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      {fields.map((f) => {
        const hasSavedSecret = f.secret && existing?.config?.[f.key];
        return (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label className="k">{f.label}{f.secret ? ' (secret)' : ''}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              value={values[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={hasSavedSecret ? '•••••••• (saved — leave blank to keep)' : ''}
              style={inputStyle}
              autoComplete="off"
            />
          </div>
        );
      })}

      <label className="row" style={{ gap: 8, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--blue)' }}
        />
        <span style={{ fontSize: 13 }}>Enabled</span>
      </label>

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        {type === 'supabase' && (
          <button className="btn ghost sm" onClick={onTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
        )}
        <button className="btn sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedMsg && <span className="sub" style={{ color: 'var(--ok)' }}>{savedMsg}</span>}
        {testMsg && (
          <span className="sub" style={{ color: testMsg.ok ? 'var(--ok)' : 'var(--crit)' }}>
            {testMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
