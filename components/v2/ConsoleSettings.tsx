'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  settingsForSection,
  type SettingDef,
} from '@/lib/settings/schema';

// ---------------------------------------------------------------------------
// Console Settings hub — client shell.
//
// Renders the left category nav + the active panel. Nav items either:
//   * link to a real feature page (href)         → <Link>
//   * open an editable settings panel (section)  → local section switch
//   * open an informational panel (info)         → local section switch
//
// Every editable field is loaded from /api/v2/settings/console and is BLANK when
// unset. Saving a panel POSTs only that panel's keys. Nothing is fabricated.
// ---------------------------------------------------------------------------

type NavItem = { label: string; href?: string; section?: string };
type NavGroup = { group: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'General', section: 'general' },
      { label: 'Appearance & themes', section: 'appearance' },
      { label: 'Sections & navigation', section: 'nav_info' },
    ],
  },
  {
    group: 'People & access',
    items: [
      { label: 'Roles & permissions', href: '/v2/access/orgs' },
      { label: 'App access', href: '/v2/access/apps' },
      { label: 'SSO · Clerk', section: 'sso' },
    ],
  },
  {
    group: 'Hermes',
    items: [
      { label: 'Governance', href: '/v2/settings/hermes' },
      { label: 'Departments & agents', href: '/v2/hermes/agents' },
      { label: 'Approvals queue', href: '/v2/hermes/approvals' },
      { label: 'Escalation routing', href: '/v2/support/needs-human' },
      { label: 'Testing', href: '/v2/hermes/testing' },
    ],
  },
  {
    group: 'Platform',
    items: [
      { label: 'Integrations', href: '/v2/hermes/integrations' },
      { label: 'Observability', href: '/v2/hermes/observability' },
      { label: 'Monitoring & ops', href: '/v2/operations' },
      { label: 'Security & scans', href: '/v2/security' },
      { label: 'SLA policies', section: 'sla' },
    ],
  },
  {
    group: 'Data & billing',
    items: [
      { label: 'Activity & audit', href: '/v2/activity' },
      { label: 'Roadmap', href: '/v2/roadmap' },
      { label: 'Notifications', section: 'notifications' },
      { label: 'Data & retention', section: 'retention' },
      { label: 'Billing & plans', section: 'billing' },
    ],
  },
];

// Human title + subtitle for each panel.
const PANEL_META: Record<string, { title: string; sub: string }> = {
  general: { title: 'General', sub: 'Identity, localisation and defaults for the console' },
  appearance: { title: 'Appearance & themes', sub: 'How the console looks by default' },
  notifications: { title: 'Notifications', sub: 'Where the console sends operational notifications' },
  sla: { title: 'SLA policies', sub: 'Target response time per priority (hours)' },
  retention: { title: 'Data & retention', sub: 'How long the console keeps each kind of record (days)' },
  billing: { title: 'Billing & plans', sub: 'Subscription and invoices' },
  sso: { title: 'SSO · Clerk', sub: 'Single sign-on for the console' },
  nav_info: { title: 'Sections & navigation', sub: 'How the console rail is organised' },
};

type FormValue = string | boolean;
type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string };

export default function ConsoleSettings() {
  const [active, setActive] = useState<string>('general');
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<Record<string, FormValue>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  function hydrate(next: Record<string, unknown>) {
    const f: Record<string, FormValue> = {};
    // Build the working copy for EVERY known key: blank when unset.
    for (const group of GROUPS) {
      for (const it of group.items) {
        if (!it.section) continue;
        for (const def of settingsForSection(it.section)) {
          f[def.key] = toFormValue(def, next[def.key]);
        }
      }
    }
    setForm(f);
  }

  async function load() {
    try {
      const res = await fetch('/api/v2/settings/console');
      const data = (await res.json()) as { settings?: Record<string, unknown> };
      const s = data.settings ?? {};
      setValues(s);
      hydrate(s);
    } catch {
      setValues({});
      hydrate({});
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key: string, v: FormValue) {
    setForm((prev) => ({ ...prev, [key]: v }));
    setSave({ kind: 'idle' });
  }

  async function handleSave(section: string) {
    setSave({ kind: 'saving' });
    const entries: Record<string, unknown> = {};
    for (const def of settingsForSection(section)) {
      entries[def.key] = form[def.key];
    }
    try {
      const res = await fetch('/api/v2/settings/console', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section, values: entries }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        settings?: Record<string, unknown>;
      };
      if (!res.ok || !data.ok) {
        setSave({ kind: 'error', msg: data.error ?? 'Save failed.' });
        return;
      }
      const s = data.settings ?? {};
      setValues(s);
      hydrate(s);
      setSave({ kind: 'saved' });
    } catch {
      setSave({ kind: 'error', msg: 'Network error while saving.' });
    }
  }

  const meta = PANEL_META[active] ?? { title: 'Settings', sub: '' };
  const isEditable = ['general', 'appearance', 'notifications', 'sla', 'retention', 'billing'].includes(active);

  return (
    <div className="v2-set-layout">
      {/* LEFT — category nav */}
      <aside className="v2-set-nav">
        <div className="v2-set-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Search settings…
        </div>
        {GROUPS.map((g) => (
          <div key={g.group}>
            <div className="v2-set-group">{g.group}</div>
            {g.items.map((it) => {
              const on = it.section === active;
              const cls = `v2-set-item${on ? ' on' : ''}`;
              if (it.href) {
                return (
                  <Link key={it.label} href={it.href} className={cls}>
                    <span className="dot" />
                    {it.label}
                  </Link>
                );
              }
              return (
                <button
                  key={it.label}
                  type="button"
                  className={cls}
                  onClick={() => {
                    setActive(it.section!);
                    setSave({ kind: 'idle' });
                  }}
                >
                  <span className="dot" />
                  {it.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* RIGHT — active panel */}
      <div className="v2-set-content">
        <div className="v2-set-head" style={{ margin: 0 }}>
          <div>
            <h2 className="v2-h1" style={{ fontSize: 18 }}>{meta.title}</h2>
            <div className="v2-sub">{meta.sub}</div>
          </div>
          {isEditable ? (
            <div className="v2-set-save">
              <button
                className="v2-btn"
                onClick={() => void handleSave(active)}
                disabled={!loaded || save.kind === 'saving'}
              >
                {save.kind === 'saving' ? 'Saving…' : 'Save changes'}
              </button>
              {save.kind === 'saved' ? <span className="v2-set-status saved">Saved ✓</span> : null}
              {save.kind === 'error' ? (
                <span className="v2-set-status error">{save.msg ?? 'Save failed.'}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {!loaded ? (
          <div className="v2-set-section">Loading settings…</div>
        ) : (
          <PanelBody section={active} form={form} onField={setField} />
        )}
      </div>
    </div>
  );
}

function toFormValue(def: SettingDef, raw: unknown): FormValue {
  if (def.type === 'boolean') return raw === true;
  if (raw === undefined || raw === null) return '';
  if (def.type === 'number') return typeof raw === 'number' ? String(raw) : String(raw);
  return typeof raw === 'string' ? raw : String(raw);
}

function PanelBody({
  section,
  form,
  onField,
}: {
  section: string;
  form: Record<string, FormValue>;
  onField: (key: string, v: FormValue) => void;
}) {
  if (section === 'nav_info') {
    return (
      <section className="v2-set-section">
        <h3>Sections & navigation</h3>
        <div className="desc">How the console rail is organised.</div>
        <div className="v2-set-info">
          The console navigation is defined in code (<code>lib/v2/nav.ts</code>) and is
          gated per role. There is nothing to configure here — a section appears in the
          rail when your role grants access to it. Manage who can see what under{' '}
          <Link href="/v2/access/orgs" className="v2-set-link">Roles &amp; permissions</Link>.
        </div>
      </section>
    );
  }

  if (section === 'sso') {
    return (
      <section className="v2-set-section">
        <h3>SSO · Clerk</h3>
        <div className="desc">Single sign-on for the console.</div>
        <div className="v2-set-info">
          Authentication is handled by Clerk. Sign-in methods, social / SAML connections,
          session lifetimes and MFA are configured in the Clerk dashboard, not here.
          <div style={{ marginTop: 12 }}>
            <a
              href="https://dashboard.clerk.com"
              target="_blank"
              rel="noopener noreferrer"
              className="v2-set-link"
            >
              Open the Clerk dashboard →
            </a>
          </div>
        </div>
      </section>
    );
  }

  const defs = settingsForSection(section);

  return (
    <>
      {section === 'billing' ? (
        <section className="v2-set-section">
          <h3>Plan &amp; invoices</h3>
          <div className="desc">Subscription, payment method and invoices.</div>
          <div className="v2-set-info">
            Billing is managed in Stripe. Plans, payment methods and invoices are not stored
            in the console — set the customer billing-portal URL below so the console can link
            straight to it.
          </div>
        </section>
      ) : null}

      <section className="v2-set-section">
        <h3>{PANEL_META[section]?.title ?? 'Settings'}</h3>
        <div className="desc">All fields are blank until you set them.</div>
        <div className="v2-set-fields two">
          {defs
            .filter((d) => d.type !== 'boolean')
            .map((def) => (
              <Field key={def.key} def={def} form={form} onField={onField} />
            ))}
        </div>

        {defs
          .filter((d) => d.type === 'boolean')
          .map((def) => (
            <div className="v2-set-toggle" key={def.key}>
              <div>
                <div className="lab">{def.label}</div>
              </div>
              <button
                type="button"
                aria-pressed={form[def.key] === true}
                className={`v2-set-switch btn${form[def.key] === true ? ' on' : ''}`}
                onClick={() => onField(def.key, !(form[def.key] === true))}
              />
            </div>
          ))}

        {section === 'general' && (form['brand_accent'] as string)?.trim() ? (
          <div className="v2-set-toggle">
            <div>
              <div className="lab">Accent preview</div>
              <div className="note">Live preview of the hex you entered above.</div>
            </div>
            <span
              className="v2-set-swatch"
              style={{ background: String(form['brand_accent']) }}
            />
          </div>
        ) : null}
      </section>
    </>
  );
}

function Field({
  def,
  form,
  onField,
}: {
  def: SettingDef;
  form: Record<string, FormValue>;
  onField: (key: string, v: FormValue) => void;
}) {
  const val = (form[def.key] ?? '') as string;

  if (def.type === 'select') {
    return (
      <div className="v2-set-field">
        <span className="v2-set-label">{def.label}</span>
        <select
          className="v2-set-input"
          value={val}
          onChange={(e) => onField(def.key, e.target.value)}
        >
          <option value="">—</option>
          {def.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="v2-set-field">
      <span className="v2-set-label">{def.label}</span>
      <input
        className="v2-set-input"
        type={def.type === 'number' ? 'number' : 'text'}
        value={val}
        min={def.type === 'number' ? def.min : undefined}
        max={def.type === 'number' ? def.max : undefined}
        onChange={(e) => onField(def.key, e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}
