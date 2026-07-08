'use client';

import { useEffect, useState } from 'react';
import './hermes-provider.css';

type HermesSettings = {
  model: string;
  hasKey: boolean;
  keyHint?: string;
  source: 'infisical' | 'db' | 'env' | 'none';
};

type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

export default function HermesProviderSettings() {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<HermesSettings | null>(null);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  async function loadSettings() {
    try {
      const res = await fetch('/api/v2/settings/hermes');
      const data = (await res.json()) as HermesSettings;
      setSettings(data);
      setModel(data.model ?? '');
      // If no key is set, show the input directly; otherwise keep it hidden
      // behind the "Replace key" reveal.
      setShowKeyInput(!data.hasKey);
      setApiKey('');
    } catch {
      setSettings({ model: '', hasKey: false, source: 'none' });
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function post(body: { model?: string; apiKey?: string; clearKey?: boolean }) {
    const res = await fetch('/api/v2/settings/hermes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; error?: string };
  }

  async function handleSave() {
    setSave({ kind: 'saving' });
    try {
      const body: { model?: string; apiKey?: string } = { model };
      // Only send the key if the password field is non-empty — the GET never
      // returns a key, so an empty field means "leave the existing key alone".
      if (apiKey.trim() !== '') body.apiKey = apiKey;
      const result = await post(body);
      if (!result.ok) {
        setSave({ kind: 'error', msg: result.error ?? 'Save failed.' });
        return;
      }
      setApiKey('');
      setSave({ kind: 'saved' });
      // Re-fetch so a newly-set key flips the status to "Key set ✓".
      await loadSettings();
    } catch {
      setSave({ kind: 'error', msg: 'Network error while saving.' });
    }
  }

  async function handleRemoveKey() {
    setSave({ kind: 'saving' });
    try {
      const result = await post({ clearKey: true });
      if (!result.ok) {
        setSave({ kind: 'error', msg: result.error ?? 'Could not remove key.' });
        return;
      }
      setApiKey('');
      setSave({ kind: 'idle' });
      await loadSettings();
    } catch {
      setSave({ kind: 'error', msg: 'Network error while removing key.' });
    }
  }

  if (!loaded || !settings) {
    return <div className="v2-hp-loading">Loading provider…</div>;
  }

  return (
    <div className="v2-hp-body">
      {/* Provider */}
      <div className="v2-hp-field">
        <span className="v2-hp-label">Provider</span>
        <div className="v2-hp-provider">
          <span className="v2-hp-dot" aria-hidden />
          OpenRouter
        </div>
        <span className="v2-hp-help">One key, any model — Claude, GPT, Llama, etc.</span>
      </div>

      {/* Model */}
      <div className="v2-hp-field">
        <span className="v2-hp-label">Model</span>
        <input
          className="v2-hp-input"
          type="text"
          placeholder="anthropic/claude-3.5-sonnet"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {/* API key */}
      <div className="v2-hp-field">
        <span className="v2-hp-label">API key</span>

        {settings.hasKey ? (
          <>
            <div className="v2-hp-keyrow">
              <span className="v2-hp-keyset">
                Key set <span className="ok">✓</span>
                {settings.keyHint ? <span>{settings.keyHint}</span> : null}
                <span className="src">
                  · {settings.source === 'infisical' ? 'Managed in Infisical' : `via ${settings.source}`}
                </span>
              </span>
              {!showKeyInput ? (
                <button
                  type="button"
                  className="v2-hp-textbtn"
                  onClick={() => setShowKeyInput(true)}
                >
                  Replace key
                </button>
              ) : null}
              <button
                type="button"
                className="v2-hp-textbtn danger"
                onClick={() => void handleRemoveKey()}
                disabled={save.kind === 'saving'}
              >
                Remove key
              </button>
            </div>

            {showKeyInput ? (
              <div className="v2-hp-reveal">
                <input
                  className="v2-hp-input"
                  type="password"
                  placeholder="sk-or-v1-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="v2-hp-note">
                  Enter a new OpenRouter API key to replace the current one.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <input
              className="v2-hp-input"
              type="password"
              placeholder="sk-or-v1-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="v2-hp-note">Enter your OpenRouter API key.</span>
          </>
        )}
      </div>

      {settings.source === 'env' ? (
        <div className="v2-hp-note env">Currently using the OPENROUTER_API_KEY env var.</div>
      ) : null}

      {/* Save */}
      <div className="v2-hp-foot">
        <button className="v2-btn" onClick={() => void handleSave()} disabled={save.kind === 'saving'}>
          {save.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {save.kind === 'saved' ? <span className="v2-hp-status saved">Saved ✓</span> : null}
        {save.kind === 'error' ? (
          <span className="v2-hp-status error">{save.msg ?? 'Save failed.'}</span>
        ) : null}
      </div>
    </div>
  );
}
