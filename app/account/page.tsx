import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';

const toggles = [
  { label: 'Critical & high findings', on: true },
  { label: 'New ticket assigned to me', on: true },
  { label: 'Scan completion digests', on: false },
  { label: 'Weekly posture summary', on: true },
];

function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ width: 38, height: 22, borderRadius: 12, background: on ? 'var(--accent, #2D6CFF)' : 'var(--panel-2)', position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
    </span>
  );
}

export default async function AccountPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Account</div><div className="sub">Your operator profile and preferences</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, flexShrink: 0 }}>BP</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>Ben Percival</div>
              <div className="sub"><span className="mono">bpercival92@gmail.com</span></div>
              <div className="mt"><span className="tag st-blue">ops_admin</span></div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 14px' }} />
          <div className="kv">
            <div className="r"><span className="k2">Member since</span><span>Jan 2026</span></div>
            <div className="r"><span className="k2">Last sign-in</span><span>Today, 09:14</span></div>
            <div className="r"><span className="k2">Auth provider</span><span>Clerk (invite-only)</span></div>
          </div>
          <div className="mt"><button className="btn ghost">Sign out</button></div>
        </div>

        <div className="card">
          <div className="panel-h"><h3>Preferences</h3></div>
          <div className="kv mb">
            <div className="r"><span className="k2">Theme</span><span><span className="chip on">Dark</span><span className="chip">Light</span></span></div>
          </div>
          <div className="h2 mb">Notifications</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {toggles.map((t) => (
              <div key={t.label} className="spread">
                <span style={{ fontSize: 13 }}>{t.label}</span>
                <Toggle on={t.on} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt sub"><Link className="link" href="/settings">← Back to settings</Link></div>
    </div>
  );
}
