import { activity } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

const earlier = [
  { icon: '🎫', text: 'Ticket OPS-0004 created — Roll out CSP + HSTS at nginx', when: 'Yesterday · 4:12 pm' },
  { icon: '⚑', text: 'Abuse rule "Velocity · signups/IP" triggered for 3 accounts', when: 'Yesterday · 11:40 am' },
  { icon: '✓', text: 'Scan run #1038 (Trivy) failed and was retried', when: '2 days ago' },
  { icon: '📘', text: 'KB article "Hardening the Docker socket" updated by ben', when: '2 days ago' },
  { icon: '⟳', text: 'Nightly scan suite completed — 1 new finding', when: '2 days ago' },
];

function Feed({ items }: { items: { icon: string; text: string; when: string }[] }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map((a, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>{a.icon}</div>
            <div><div style={{ fontSize: 13 }}>{a.text}</div><div className="sub" style={{ fontSize: 11 }}>{a.when}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ActivityPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Activity</div><div className="sub">Everything that happened across findings, tickets, scans & abuse</div></div>
        <button className="btn ghost sm">⭳ Export</button>
      </div>

      <div className="h2 mb">Today</div>
      <div className="mb"><Feed items={activity} /></div>

      <div className="h2 mb">Earlier</div>
      <Feed items={earlier} />
    </div>
  );
}
