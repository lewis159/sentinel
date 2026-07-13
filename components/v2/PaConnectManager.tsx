'use client';

import { useEffect, useState } from 'react';

// Drives the PA Google connect surface: shows connection status (presence +
// updatedAt — NEVER the token value) and lets an admin paste/rotate the PA's
// Google access token. The value is write-only: it's POSTed to the server and
// never read back.
type Status = { infisicalConfigured: boolean; connected: boolean; updatedAt?: string };

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PaConnectManager() {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/v2/hermes/pa-connect');
      setStatus((await res.json()) as Status);
    } catch {
      setStatus({ infisicalConfigured: false, connected: false });
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const value = token.trim();
    if (!value) {
      setMsg({ kind: 'err', text: 'Paste a Google access token first.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v2/hermes/pa-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setToken('');
        setMsg({ kind: 'ok', text: 'Token stored. The PA can now read your calendar + email.' });
        await load();
      } else {
        setMsg({ kind: 'err', text: data.error ?? 'Failed to store the token.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Network error storing the token.' });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="v2-sub">Loading…</div>;

  const connected = status?.connected ?? false;

  return (
    <div className="v2-set-card" style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: connected ? 'var(--v2-ok, #22c55e)' : 'var(--v2-muted, #94a3b8)',
          }}
        />
        <strong>{connected ? 'Google connected' : 'Not connected'}</strong>
        <span className="v2-sub" style={{ marginLeft: 'auto' }}>
          {connected ? `Token stored · updated ${fmtDate(status?.updatedAt)}` : 'No PA Google token stored'}
        </span>
      </div>

      {!status?.infisicalConfigured && (
        <div className="v2-sub" style={{ color: 'var(--v2-warn, #f59e0b)' }}>
          Infisical isn&apos;t configured in this environment — a pasted token can&apos;t be persisted here.
          Set <code>PA_GOOGLE_ACCESS_TOKEN</code> in the deploy env instead.
        </div>
      )}

      <label style={{ display: 'grid', gap: 6 }}>
        <span className="v2-sub">Google access token (write-only — never shown back)</span>
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ya29.…"
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--v2-border, #334155)', background: 'transparent', color: 'inherit' }}
        />
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="v2-btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Storing…' : connected ? 'Rotate token' : 'Connect Google'}
        </button>
        {msg && (
          <span className="v2-sub" style={{ color: msg.kind === 'ok' ? 'var(--v2-ok, #22c55e)' : 'var(--v2-err, #ef4444)' }}>
            {msg.text}
          </span>
        )}
      </div>

      <div className="v2-sub" style={{ borderTop: '1px solid var(--v2-border, #334155)', paddingTop: 12, lineHeight: 1.6 }}>
        <strong>OAuth scopes to grant on the consent screen:</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li><code>calendar</code> — read + create events</li>
          <li><code>gmail.readonly</code> — read recent mail</li>
          <li><code>gmail.compose</code> — create drafts</li>
          <li><code>gmail.send</code> — optional (the PA can also send via Resend)</li>
        </ul>
        <p style={{ marginTop: 8 }}>
          Mint a token via the OAuth consent flow (e.g. the OAuth Playground), then paste the access token
          above. Alternatively set the refresh-token env trio (<code>PA_GOOGLE_REFRESH_TOKEN</code>,{' '}
          <code>PA_GOOGLE_CLIENT_ID</code>, <code>PA_GOOGLE_CLIENT_SECRET</code>) so the PA refreshes its
          own token. Until a token is present, the PA&apos;s calendar/email tools report{' '}
          <code>not_configured</code> and degrade gracefully.
        </p>
      </div>
    </div>
  );
}
