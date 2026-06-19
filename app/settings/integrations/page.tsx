import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';

const groups = [
  {
    title: 'Scanners',
    items: [
      { name: 'npm-audit', desc: 'Dependency vulnerability scanning', connected: true },
      { name: 'gitleaks', desc: 'Secret detection across the repo', connected: true },
      { name: 'Trivy', desc: 'Container & filesystem image scanning', connected: true },
    ],
  },
  {
    title: 'Webhook-in sources',
    items: [
      { name: 'Dependabot', desc: 'Inbound dependency alerts', connected: true },
      { name: 'Uptime Kuma', desc: 'Inbound uptime / availability events', connected: false },
    ],
  },
  {
    title: 'Platform',
    items: [
      { name: 'Hermes AI', desc: 'Self-hosted triage & summarisation', connected: true },
      { name: 'Supabase', desc: 'Ops schema for findings & tickets', connected: true },
      { name: 'Clerk', desc: 'Invite-only authentication', connected: false },
    ],
  },
];

export default async function IntegrationsPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Integrations</div><div className="sub">Connected scanners, sources and platform services</div></div>
      </div>

      {groups.map((g) => (
        <div key={g.title} className="mb">
          <div className="h2 mb">{g.title}</div>
          <div className="grid grid-3">
            {g.items.map((i) => (
              <div key={i.name} className="card">
                <div className="spread">
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`status-dot ${i.connected ? '' : 'mute'}`} style={{ background: i.connected ? 'var(--ok)' : 'var(--muted)' }} />
                    <span className="t" style={{ fontWeight: 700 }}>{i.name}</span>
                  </div>
                  <span className="sub">{i.connected ? 'Connected' : 'Not connected'}</span>
                </div>
                <div className="sub" style={{ marginTop: 8 }}>{i.desc}</div>
                <div className="mt"><a className="link" href="#">Configure →</a></div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt sub"><Link className="link" href="/settings">← Back to settings</Link></div>
    </div>
  );
}
