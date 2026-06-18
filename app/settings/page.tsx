import Link from 'next/link';

const cards = [
  { href: '/settings/connectors', icon: '🔗', title: 'Connectors', desc: 'Configure how Sentinel connects to external systems — Supabase, Docker, Hermes and more.' },
  { href: '/settings/channels', icon: '🔔', title: 'Channels', desc: 'Where alerts are delivered — email, Slack, Telegram, webhooks.' },
  { href: '/settings/integrations', icon: '🔌', title: 'Integrations', desc: 'Scanners, webhook sources, Hermes AI, Supabase and Clerk.' },
  { href: '/settings/schedules', icon: '🕑', title: 'Scan schedules', desc: 'When each automated check runs and its cadence.' },
  { href: '/settings/roles', icon: '🛡️', title: 'Roles & access', desc: 'Capability matrix and console membership.' },
  { href: '/account', icon: '👤', title: 'Account', desc: 'Your operator profile and personal preferences.' },
];

export default function SettingsPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Settings</div><div className="sub">Configure Sentinel — channels, integrations and access</div></div>
      </div>

      <div className="grid grid-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ display: 'block', textDecoration: 'none' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>{c.icon}</div>
              <div>
                <div className="t" style={{ fontWeight: 700 }}>{c.title}</div>
                <div className="sub" style={{ marginTop: 4 }}>{c.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
