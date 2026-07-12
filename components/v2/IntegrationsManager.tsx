'use client';

import { useEffect, useState } from 'react';
import './integrations.css';

// Mirrors the server IntegrationStatus / IntegrationsPayload shapes. NEVER
// carries a secret value — only presence + metadata.
type SecretKeyStatus = { key: string; present: boolean; updatedAt?: string };
type FlagState = {
  flag: string;
  enabled: boolean;
  envDefault: boolean;
  source: 'db' | 'env';
  updatedAt?: string;
  updatedBy?: string | null;
};
type IntegrationStatus = {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  testable: boolean;
  flag?: string;
  secrets: SecretKeyStatus[];
  configured: boolean;
  updatedAt?: string;
  flagState?: FlagState;
};
type Payload = { infisicalConfigured: boolean; integrations: IntegrationStatus[] };

type TestResult = { ok: boolean; detail: string; status: string };
type RowUi = {
  keyInput: string;
  showInput: boolean;
  saving: boolean;
  saveMsg?: { kind: 'ok' | 'err'; text: string };
  testing: boolean;
  test?: TestResult;
  flagBusy: boolean;
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function IntegrationsManager() {
  const [loaded, setLoaded] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [ui, setUi] = useState<Record<string, RowUi>>({});

  function patchUi(id: string, patch: Partial<RowUi>) {
    setUi((prev) => ({ ...prev, [id]: { ...blankRow(), ...prev[id], ...patch } }));
  }

  function blankRow(): RowUi {
    return { keyInput: '', showInput: false, saving: false, testing: false, flagBusy: false };
  }

  async function load() {
    try {
      const res = await fetch('/api/v2/admin/integrations');
      const data = (await res.json()) as Payload;
      setPayload(data);
      // Seed UI: reveal the key input for integrations with nothing configured.
      const seed: Record<string, RowUi> = {};
      for (const i of data.integrations) {
        seed[i.id] = { ...blankRow(), showInput: !i.configured };
      }
      setUi(seed);
    } catch {
      setPayload({ infisicalConfigured: false, integrations: [] });
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveKey(id: string) {
    const row = ui[id] ?? blankRow();
    const value = row.keyInput.trim();
    if (!value) {
      patchUi(id, { saveMsg: { kind: 'err', text: 'Enter a key first.' } });
      return;
    }
    patchUi(id, { saving: true, saveMsg: undefined });
    try {
      const res = await fetch(`/api/v2/admin/integrations/${id}/key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        patchUi(id, { saving: false, saveMsg: { kind: 'err', text: data.error ?? 'Save failed.' } });
        return;
      }
      patchUi(id, { saving: false, keyInput: '', showInput: false, saveMsg: { kind: 'ok', text: 'Saved ✓' } });
      await load();
    } catch {
      patchUi(id, { saving: false, saveMsg: { kind: 'err', text: 'Network error.' } });
    }
  }

  async function runTest(id: string) {
    patchUi(id, { testing: true, test: undefined });
    try {
      const res = await fetch(`/api/v2/admin/integrations/${id}/test`, { method: 'POST' });
      const data = (await res.json()) as TestResult;
      patchUi(id, { testing: false, test: data });
    } catch {
      patchUi(id, { testing: false, test: { ok: false, detail: 'Network error.', status: 'fail' } });
    }
  }

  async function toggleFlag(id: string, next: boolean) {
    patchUi(id, { flagBusy: true });
    try {
      const res = await fetch(`/api/v2/admin/integrations/${id}/flag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        patchUi(id, { flagBusy: false, saveMsg: { kind: 'err', text: data.error ?? 'Toggle failed.' } });
        return;
      }
      patchUi(id, { flagBusy: false });
      await load();
    } catch {
      patchUi(id, { flagBusy: false, saveMsg: { kind: 'err', text: 'Network error.' } });
    }
  }

  if (!loaded || !payload) {
    return <div className="v2-int-loading">Loading integrations…</div>;
  }

  return (
    <div className="v2-int">
      {!payload.infisicalConfigured ? (
        <div className="v2-int-banner warn">
          <strong>Infisical not configured.</strong> Set{' '}
          <code>INFISICAL_CLIENT_ID</code>, <code>INFISICAL_CLIENT_SECRET</code>,{' '}
          <code>INFISICAL_PROJECT_ID</code> (and optionally <code>INFISICAL_SITE_URL</code> /{' '}
          <code>INFISICAL_ENVIRONMENT</code>) on the stack to set or rotate keys. Status below
          reflects env-only fallbacks; feature flags still toggle.
        </div>
      ) : null}

      {payload.integrations.map((it) => {
        const row = ui[it.id] ?? blankRow();
        const badge = it.configured ? 'ok' : payload.infisicalConfigured ? 'off' : 'unknown';
        const badgeText = it.configured ? 'Configured' : payload.infisicalConfigured ? 'Not set' : 'Unknown';

        return (
          <div key={it.id} className="v2-card v2-int-row">
            <div className="v2-int-head">
              <div className="v2-int-title">
                <span className={`v2-int-badge ${badge}`}>{badgeText}</span>
                <h3>{it.label}</h3>
                {it.docsUrl ? (
                  <a className="v2-int-docs" href={it.docsUrl} target="_blank" rel="noreferrer">
                    docs ↗
                  </a>
                ) : null}
              </div>
              <div className="v2-int-desc">{it.description}</div>
            </div>

            <div className="v2-int-meta">
              <span className="v2-int-metaitem">
                <span className="lab">Secret{it.secrets.length > 1 ? 's' : ''}</span>
                <span className="val">
                  {it.secrets.map((s) => (
                    <code key={s.key} className={s.present ? 'present' : 'missing'} title={s.present ? 'present' : 'not set'}>
                      {s.key}
                    </code>
                  ))}
                </span>
              </span>
              <span className="v2-int-metaitem">
                <span className="lab">Last updated</span>
                <span className="val">{fmtDate(it.updatedAt)}</span>
              </span>
              {it.flag ? (
                <span className="v2-int-metaitem">
                  <span className="lab">Feature flag</span>
                  <span className="val flag">
                    <code>{it.flag}</code>
                    {it.flagState ? (
                      <span className={`v2-int-src ${it.flagState.source}`}>
                        {it.flagState.source === 'db' ? 'override' : `env (${it.flagState.envDefault ? 'on' : 'off'})`}
                      </span>
                    ) : null}
                  </span>
                </span>
              ) : null}
            </div>

            <div className="v2-int-actions">
              {/* Flag toggle */}
              {it.flag ? (
                <label className="v2-int-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(it.flagState?.enabled)}
                    disabled={row.flagBusy}
                    onChange={(e) => void toggleFlag(it.id, e.target.checked)}
                  />
                  <span className="track" aria-hidden />
                  <span className="lbl">{it.flagState?.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              ) : (
                <span className="v2-int-noflag">No feature flag</span>
              )}

              {/* Test */}
              {it.testable ? (
                <button
                  type="button"
                  className="v2-btn ghost"
                  disabled={row.testing}
                  onClick={() => void runTest(it.id)}
                >
                  {row.testing ? 'Testing…' : 'Test connection'}
                </button>
              ) : (
                <span className="v2-int-noflag">No test</span>
              )}
              {row.test ? (
                <span className={`v2-int-test ${row.test.ok ? 'ok' : 'fail'}`}>
                  {row.test.ok ? '✓' : '✕'} {row.test.detail}
                </span>
              ) : null}
            </div>

            {/* Set / rotate key */}
            <div className="v2-int-key">
              {!row.showInput ? (
                <button type="button" className="v2-int-textbtn" onClick={() => patchUi(it.id, { showInput: true })}>
                  {it.configured ? 'Rotate key' : 'Set key'}
                </button>
              ) : (
                <div className="v2-int-keyrow">
                  <input
                    className="v2-int-input"
                    type="password"
                    placeholder={`New ${it.secrets[0]?.key ?? 'key'} value`}
                    value={row.keyInput}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!payload.infisicalConfigured || row.saving}
                    onChange={(e) => patchUi(it.id, { keyInput: e.target.value })}
                  />
                  <button
                    type="button"
                    className="v2-btn"
                    disabled={!payload.infisicalConfigured || row.saving}
                    onClick={() => void saveKey(it.id)}
                  >
                    {row.saving ? 'Saving…' : 'Save'}
                  </button>
                  {it.configured ? (
                    <button
                      type="button"
                      className="v2-int-textbtn"
                      onClick={() => patchUi(it.id, { showInput: false, keyInput: '' })}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              )}
              {row.saveMsg ? (
                <span className={`v2-int-status ${row.saveMsg.kind}`}>{row.saveMsg.text}</span>
              ) : null}
              {row.showInput && !payload.infisicalConfigured ? (
                <span className="v2-int-note">Writes need the Infisical machine identity (see banner above).</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
