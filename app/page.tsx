import Link from 'next/link';
import { findings, sevCounts, scanRuns, activity, sevClass, sevLabel } from '@/lib/mock';
import { getPlatformStats } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  await requireGlobalAdminPage();
  const open = findings.filter((f) => f.status !== 'fixed');
  const stats = await getPlatformStats();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Security posture</div><div className="sub">Last scan 14 minutes ago · 8 checks · 1 node</div></div>
        <button className="btn">⟳ Run scan now</button>
      </div>

      {/* Platform being monitored — REAL data from the shared YT database */}
      <div className="card mb">
        <div className="panel-h">
          <div className="row" style={{ gap: 10 }}>
            <h3>Platform monitored</h3>
            <span className="pill" style={{ background: stats.live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)', color: stats.live ? '#5fd49b' : '#aab3c4' }}>
              <span className="dot" style={{ background: stats.live ? 'var(--ok)' : 'var(--muted)' }} />
              {stats.live ? 'LIVE · YT Transcriber' : 'mock'}
            </span>
          </div>
          <Link className="link" href="/users">User audit →</Link>
        </div>
        <div className="grid grid-3">
          <div><div className="k">Accounts</div><div className="v">{stats.users}</div></div>
          <div><div className="k">Videos transcribed</div><div className="v">{stats.videos}</div></div>
          <div><div className="k">Transcripts stored</div><div className="v">{stats.transcripts}</div></div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4 mb">
        <div className="card">
          <div className="k">Security score</div>
          <div className="row" style={{ gap: 14, marginTop: 6 }}>
            <Donut value={78} />
            <div><div style={{ fontSize: 26, fontWeight: 800 }}>78</div><div className="sub">/ 100</div></div>
          </div>
        </div>
        <div className="card"><div className="k">Open findings</div><div className="v">{open.length}</div><div className="sub" style={{ color: '#ff8b8e' }}>▲ 3 since last week</div></div>
        <div className="card"><div className="k">Critical / High</div><div className="v" style={{ color: '#ff7b7e' }}>{sevCounts.critical} <span style={{ color: 'var(--muted)', fontSize: 18 }}>/</span> {sevCounts.high}</div><div className="sub">need attention now</div></div>
        <div className="card"><div className="k">Resolved (30d)</div><div className="v" style={{ color: '#5fd49b' }}>31</div><div className="sub" style={{ color: '#5fd49b' }}>▼ MTTR 2.4 days</div></div>
      </div>

      <div className="grid grid-main mb">
        {/* Open findings */}
        <div className="card pad0">
          <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Open findings</h3><Link className="link" href="/findings">View all →</Link></div>
          <table>
            <thead><tr><th>Severity</th><th>Finding</th><th>Component</th><th>Status</th></tr></thead>
            <tbody>
              {open.slice(0, 6).map((f) => (
                <tr key={f.ref} className="clickable">
                  <td><span className={`pill ${sevClass[f.severity]}`}>● {sevLabel[f.severity]}</span></td>
                  <td><Link href={`/findings/${f.ref}`}><div className="t">{f.title}</div><div className="d">{f.ref} · {f.cwe || '—'}</div></Link></td>
                  <td><span className="mono">{f.component}</span></td>
                  <td><StatusTag status={f.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Severity + coverage */}
        <div className="card">
          <div className="panel-h"><h3>By severity</h3></div>
          <div className="bars">
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
              <div className="bar-row" key={s}>
                <div className="bar-lab">{sevLabel[s]}</div>
                <div className="track"><div className="fill" style={{ width: `${(sevCounts[s] / 4) * 100}%`, background: `var(--${s === 'critical' ? 'crit' : s === 'high' ? 'high' : s === 'medium' ? 'med' : 'low'})` }} /></div>
                <div style={{ width: 22, textAlign: 'right', fontWeight: 700 }}>{sevCounts[s]}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 14px' }} />
          <div className="panel-h"><h3>Scan coverage</h3></div>
          <div className="bars">
            <Coverage label="Dependencies" pct={92} color="var(--ok)" />
            <Coverage label="Secrets" pct={100} color="var(--ok)" />
            <Coverage label="Headers" pct={60} color="var(--high)" />
            <Coverage label="Access audit" pct={80} color="var(--med)" />
          </div>
        </div>
      </div>

      <div className="grid grid-main">
        <div className="card pad0">
          <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Recent scans</h3><Link className="link" href="/scans/runs">Scan history →</Link></div>
          <table>
            <thead><tr><th>Run</th><th>Type</th><th>Findings</th><th>When</th></tr></thead>
            <tbody>
              {scanRuns.slice(0, 4).map((r) => (
                <tr key={r.id} className="clickable"><td><Link href={`/scans/runs/${r.id}`}><span className="mono">#{r.id}</span></Link></td><td>{r.type}</td><td><span className="tag st-blue">{r.findings}</span></td><td className="sub">{r.when}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="panel-h"><h3>Activity</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {activity.map((a, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12 }}>{a.icon}</div>
                <div><div style={{ fontSize: 12.5 }}>{a.text}</div><div className="sub" style={{ fontSize: 11 }}>{a.when}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], fixed: ['st-done', 'Fixed'],
    resolved: ['st-done', 'Resolved'], blocked: ['st-mute', 'Blocked'], acknowledged: ['st-mute', 'Acknowledged'],
  };
  const [cls, lab] = map[status] ?? ['st-mute', status];
  return <span className={`tag ${cls}`}>{lab}</span>;
}

function Coverage({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="bar-row"><div className="bar-lab">{label}</div><div className="track"><div className="fill" style={{ width: `${pct}%`, background: color }} /></div><div style={{ width: 34, textAlign: 'right', fontWeight: 700 }}>{pct}%</div></div>
  );
}

function Donut({ value }: { value: number }) {
  const off = 314 - (314 * value) / 100;
  return (
    <svg width="78" height="78" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="50" fill="none" stroke="#1d2230" strokeWidth="11" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="#2D6CFF" strokeWidth="11" strokeLinecap="round" strokeDasharray="314" strokeDashoffset={off} transform="rotate(-90 60 60)" />
    </svg>
  );
}
