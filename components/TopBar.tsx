'use client';

import { usePathname } from 'next/navigation';

const TITLES: Record<string, string> = {
  '': 'Overview', findings: 'Findings', tickets: 'Tickets', scans: 'Scans & Checks',
  infra: 'Infra', components: 'Components', users: 'User Audit', alerts: 'Alerts',
  incidents: 'Incidents', kb: 'Knowledge Base', reports: 'Reports', activity: 'Activity',
  graph: 'Graph', settings: 'Settings', account: 'Account',
};

export function TopBar() {
  const path = usePathname();
  const seg = path.split('/').filter(Boolean);
  const top = TITLES[seg[0] ?? ''] ?? 'Sentinel';

  return (
    <header className="topbar">
      <div className="crumb">
        <b>{top}</b>
        {seg[1] && <span> · {seg[1]}</span>}
      </div>
      <div className="right">
        <div className="status-dot"><span className="dot" style={{ background: 'var(--ok)' }} /> Monitoring active</div>
        <div className="search" style={{ width: 200 }}>🔍 Search · <span className="mono">⌘K</span></div>
        <button className="btn sm">⟳ Run scan</button>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#2D6CFF,#1B4DD1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>B</div>
      </div>
    </header>
  );
}
