import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import './settings.css';

export const dynamic = 'force-dynamic';

type NavItem = { label: string; href?: string; on?: boolean };
type NavGroup = { group: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'General', on: true },
      { label: 'Appearance & themes' },
      { label: 'Sections & navigation' },
    ],
  },
  {
    group: 'People & access',
    items: [
      { label: 'Roles & permissions', href: '/v2/access/orgs' },
      { label: 'App access', href: '/v2/access/apps' },
      { label: 'SSO · Clerk' },
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
      { label: 'SLA policies' },
    ],
  },
  {
    group: 'Data & billing',
    items: [
      { label: 'Activity & audit', href: '/v2/activity' },
      { label: 'Roadmap', href: '/v2/roadmap' },
      { label: 'Notifications' },
      { label: 'Data & retention' },
      { label: 'Billing & plans' },
    ],
  },
];

function NavRow({ item }: { item: NavItem }) {
  const inner = (
    <>
      <span className="dot" />
      {item.label}
    </>
  );
  const cls = `v2-set-item${item.on ? ' on' : ''}`;
  if (item.href) {
    return (
      <Link href={item.href} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export default async function V2SettingsPage() {
  await requireSectionPage('admin');

  return (
    <div>
      {/* Header */}
      <div className="v2-set-head">
        <div>
          <div className="v2-eyebrow">Console</div>
          <h1 className="v2-h1">Settings</h1>
          <div className="v2-sub">One place for everything that configures the console.</div>
        </div>
      </div>

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
              {g.items.map((it) => (
                <NavRow key={it.label} item={it} />
              ))}
            </div>
          ))}
        </aside>

        {/* RIGHT — General panel */}
        <div className="v2-set-content">
          <div className="v2-set-head" style={{ margin: 0 }}>
            <div>
              <h2 className="v2-h1" style={{ fontSize: 18 }}>General</h2>
              <div className="v2-sub">Identity, localisation and defaults for the console</div>
            </div>
            <button className="v2-btn">Save changes</button>
          </div>

          {/* Identity */}
          <section className="v2-set-section">
            <h3>Identity</h3>
            <div className="desc">How the console names itself across the estate.</div>
            <div className="v2-set-fields two">
              <div className="v2-set-field">
                <span className="v2-set-label">Organisation name</span>
                <div className="v2-set-input">Bentech · Scribuo Ops</div>
              </div>
              <div className="v2-set-field">
                <span className="v2-set-label">Console URL</span>
                <div className="v2-set-input">ops.scribuo.com</div>
              </div>
              <div className="v2-set-field">
                <span className="v2-set-label">Primary product domain</span>
                <div className="v2-set-input">scribuo.com</div>
              </div>
              <div className="v2-set-field">
                <span className="v2-set-label">Support address</span>
                <div className="v2-set-input">
                  support@scribuo.com <span className="hint">— via Resend</span>
                </div>
              </div>
            </div>
          </section>

          {/* Localisation & defaults */}
          <section className="v2-set-section">
            <h3>Localisation & defaults</h3>
            <div className="desc">Regional and presentation defaults new sessions inherit.</div>
            <div className="v2-set-fields two">
              <div className="v2-set-field">
                <span className="v2-set-label">Timezone</span>
                <div className="v2-set-input">Europe/London</div>
              </div>
              <div className="v2-set-field">
                <span className="v2-set-label">Default theme</span>
                <div className="v2-set-input">Dark</div>
              </div>
            </div>

            <div className="v2-set-toggle">
              <div>
                <div className="lab">Environment banner</div>
                <div className="note">Shows a Production marker in the top bar.</div>
              </div>
              <div className="v2-set-switch" aria-hidden />
            </div>
            <div className="v2-set-toggle">
              <div>
                <div className="lab">Brand accent</div>
                <div className="note">Accent colour used across buttons, pills and highlights.</div>
              </div>
              <div className="v2-set-swatches">
                <span className="v2-set-swatch" style={{ background: '#4C8DFF' }} />
                <span className="v2-set-swatch" style={{ background: '#2E63E0' }} />
                <span className="v2-set-label">#4C8DFF / #2E63E0</span>
              </div>
            </div>
          </section>

          <div className="v2-set-foot">
            Every section's gear icon links here — the single place all settings live.
          </div>
        </div>
      </div>
    </div>
  );
}
