import Link from 'next/link';
import { getUsers } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const AVATAR_COLORS = ['#2D6CFF', '#7c5cff', '#0ea5a3', '#d4574a', '#c9952b'];

function initials(name: string) {
  const parts = name.replace(/[*._-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}
function riskColor(risk: number) {
  if (risk >= 75) return 'var(--crit)';
  if (risk >= 50) return 'var(--high)';
  if (risk >= 30) return 'var(--med)';
  return 'var(--ok)';
}

export default async function UsersPage() {
  await requireGlobalAdminPage();
  const { rows: users, live, note } = await getUsers();
  const flagged = users.filter((u) => u.risk >= 30).length;
  const disposable = users.filter((u) => u.signals.some((s) => s.includes('Disposable'))).length;
  const fresh = users.filter((u) => u.signals.some((s) => s.includes('New account'))).length;

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">User Audit</div>
            <span className="pill" style={{ background: live ? 'rgba(51,184,122,.14)' : 'rgba(138,147,166,.16)', color: live ? '#5fd49b' : '#aab3c4' }}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · public.users' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">Multi-account &amp; abuse signals · pulled from the shared YT Transcriber database</div>
        </div>
        <button className="btn ghost sm">⭳ Export</button>
      </div>

      {flagged > 0 ? (
        <div className="card mb" style={{ borderLeft: '3px solid #2D6CFF' }}>
          <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16 }}>⚑</span>
            <div>
              <div style={{ fontWeight: 700 }}>{flagged} account{flagged === 1 ? '' : 's'} showing abuse signals</div>
              <div className="sub">Review flagged users below and consider raising a ticket.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card mb"><div className="sub">No accounts currently show abuse signals.</div></div>
      )}

      <div className="grid grid-3 mb">
        <div className="card"><div className="k">Total accounts</div><div className="v">{users.length}</div><div className="sub">{live ? 'from public.users' : 'mock'}</div></div>
        <div className="card"><div className="k">Flagged</div><div className="v" style={{ color: flagged ? '#ff8b8e' : undefined }}>{flagged}</div><div className="sub">risk ≥ 30</div></div>
        <div className="card"><div className="k">Disposable / new</div><div className="v" style={{ color: '#ffc05a' }}>{disposable} <span style={{ color: 'var(--muted)', fontSize: 16 }}>/</span> {fresh}</div><div className="sub">temp-mail · &lt;24h</div></div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>User</th><th>Tier</th><th>Risk</th><th>Signals</th><th>Joined</th></tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} className="clickable">
                <td>
                  <Link href={`/users/${u.id}`}>
                    <div className="row" style={{ gap: 10 }}>
                      <span style={{ width: 30, height: 30, borderRadius: '50%', background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{initials(u.name)}</span>
                      <span><div className="t">{u.name}</div><div className="d">{u.email}</div></span>
                    </div>
                  </Link>
                </td>
                <td><span className="tag st-blue">{u.tier}</span></td>
                <td>
                  <div className="row" style={{ gap: 9 }}>
                    <div className="track" style={{ width: 90 }}><div className="fill" style={{ width: `${u.risk}%`, background: riskColor(u.risk) }} /></div>
                    <span style={{ fontWeight: 700, width: 24 }}>{u.risk}</span>
                  </div>
                </td>
                <td>
                  {u.signals.length === 0
                    ? <span className="sub">No active signals</span>
                    : <div className="row wrap" style={{ gap: 5 }}>{u.signals.map((s) => <span key={s} className="tag st-mute">{s}</span>)}</div>}
                </td>
                <td className="sub">{u.lastSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
