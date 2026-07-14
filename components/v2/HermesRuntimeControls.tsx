'use client';

// Hermes core runtime controls — one toggle per CORE Hermes feature flag, driving
// the DB override (ops.hermes_runtime_flags) via /api/v2/admin/hermes/flags. These
// are the flags that gate the Brain itself (NOT third-party integrations), so this
// is how an operator turns the Brain on/off (and the other core subsystems) with
// NO redeploy and NO stack-env edit.
//
// Each row shows the RESOLVED state: the effective on/off value, and whether it
// comes from a DB override or the env default. Toggling writes the override and
// re-reads, so the new state (and its source flipping to "override") shows
// immediately. Mock-safe: with no DB the GET still returns env defaults and a
// toggle returns a clear error surfaced inline.
import { useEffect, useState } from 'react';
import './hermes-runtime-controls.css';

type FlagState = {
  flag: string;
  enabled: boolean;
  envDefault: boolean;
  source: 'db' | 'env';
  updatedAt?: string;
  updatedBy?: string | null;
};

// Human labels + short helper text for each core flag.
const FLAG_META: Record<string, { label: string; help: string }> = {
  HERMES_BRAIN_ENABLED: {
    label: 'Brain',
    help: 'Master switch for the Hermes Brain. Off = agents stay dormant; no graph turns run.',
  },
  HERMES_INTAKE_ENABLED: {
    label: 'Intake',
    help: 'Route inbound conversations/tickets into the Brain for triage and drafting.',
  },
  HERMES_KB_PGVECTOR: {
    label: 'KB pgvector',
    help: 'Use pgvector semantic search for knowledge Q&A instead of keyword-only fallback.',
  },
  HERMES_INNGEST_ENABLED: {
    label: 'Inngest',
    help: 'Enable background/durable job execution via Inngest for long-running agent work.',
  },
  HERMES_TELEGRAM_ENABLED: {
    label: 'Telegram',
    help: 'Accept inbound messages from allowlisted Telegram users as a Brain channel.',
  },
};

function metaFor(flag: string): { label: string; help: string } {
  return FLAG_META[flag] ?? { label: flag, help: '' };
}

type Busy = Record<string, boolean>;

export default function HermesRuntimeControls() {
  const [loaded, setLoaded] = useState(false);
  const [flags, setFlags] = useState<FlagState[] | null>(null);
  const [busy, setBusy] = useState<Busy>({});
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/v2/admin/hermes/flags');
      const data = (await res.json()) as { flags?: FlagState[]; error?: string };
      if (Array.isArray(data.flags)) {
        setFlags(data.flags);
        setErr(null);
      } else {
        setFlags([]);
        setErr(data.error ?? 'Failed to load flags.');
      }
    } catch {
      setFlags([]);
      setErr('Network error while loading flags.');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(flag: string, next: boolean) {
    setBusy((b) => ({ ...b, [flag]: true }));
    setErr(null);
    try {
      const res = await fetch('/api/v2/admin/hermes/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flag, enabled: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setErr(data.error ?? 'Toggle failed.');
        return;
      }
      // Re-read so the effective value + source (env → override) reflect the change.
      await load();
    } catch {
      setErr('Network error while toggling.');
    } finally {
      setBusy((b) => ({ ...b, [flag]: false }));
    }
  }

  if (!loaded || !flags) {
    return <div className="v2-hp-loading">Loading controls…</div>;
  }

  return (
    <div className="v2-set-hbody">
      <div className="v2-hrc-list">
        {flags.map((f) => {
          const m = metaFor(f.flag);
          return (
            <div key={f.flag} className="v2-hrc-row">
              <div className="v2-hrc-info">
                <div className="v2-hrc-top">
                  <span className="v2-hrc-name">{m.label}</span>
                  <code className="v2-hrc-flag">{f.flag}</code>
                  <span className={`v2-int-src ${f.source}`}>
                    {f.source === 'db'
                      ? 'override'
                      : `env (${f.envDefault ? 'on' : 'off'})`}
                  </span>
                </div>
                {m.help ? <span className="v2-hrc-help">{m.help}</span> : null}
              </div>

              <label className="v2-int-toggle">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  disabled={Boolean(busy[f.flag])}
                  onChange={(e) => void toggle(f.flag, e.target.checked)}
                />
                <span className="track" aria-hidden />
                <span className="lbl">{f.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          );
        })}
      </div>

      {err ? <div className="v2-hp-status error v2-hrc-err">{err}</div> : null}
    </div>
  );
}
