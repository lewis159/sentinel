import Link from 'next/link';
import { notFound } from 'next/navigation';
import { users } from '@/lib/mock';
import { LinksPanel } from '@/components/LinksPanel';
import { requireGlobalAdminPage } from '@/lib/auth';

function riskColor(risk: number) {
  if (risk >= 75) return 'var(--crit)';
  if (risk >= 50) return 'var(--high)';
  if (risk >= 30) return 'var(--med)';
  return 'var(--ok)';
}

// Inline mock: other accounts sharing this user's device / IP cluster.
const cluster = [
  { id: 'u2', acct: 'a.kowalski', device: 'fp_9af3…21', ip: '51.210.44.0/24', tier: 'Starter', when: '31 min ago' },
  { id: 'u3', acct: 'rosa.s', device: 'fp_9af3…21', ip: '51.210.44.0/24', tier: 'Pro', when: '2 h ago' },
  { id: 'u4', acct: 'tn.builds', device: 'fp_9af3…21', ip: '51.210.44.0/24', tier: 'Starter', when: '5 h ago' },
];

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;
  const u = users.find((x) => x.id === id);
  if (!u) return notFound();

  const edges = [
    { rel: 'flagged-by', type: 'finding', id: 'SEC-0007', label: 'No rate limit on /api/videos submit', href: '/findings/SEC-0007' },
    { rel: 'tracked-in', type: 'ticket', id: 'OPS-0006', label: 'Add rate limiting to public submit endpoints', href: '/tickets/OPS-0006' },
  ];

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/users">User Audit</Link> · <b>{u.name}</b></div>
        <div className="row"><button className="btn ghost sm">Suspend</button><button className="btn sm">Raise ticket</button></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card mb">
            <div className="spread">
              <div>
                <div className="h1" style={{ marginBottom: 4 }}>{u.name}</div>
                <div className="sub">{u.email}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: riskColor(u.risk) }}>{u.risk}</div>
                <div className="k">Risk score</div>
              </div>
            </div>
            <div className="track mt" style={{ marginTop: 12 }}><div className="fill" style={{ width: `${u.risk}%`, background: riskColor(u.risk) }} /></div>
          </div>

          <div className="card mb">
            <div className="panel-h"><h3>Active signals</h3></div>
            {u.signals.length === 0
              ? <div className="sub">No active signals on this account.</div>
              : <div className="row wrap" style={{ gap: 6 }}>{u.signals.map((s) => <span key={s} className="tag st-mute">{s}</span>)}</div>}
          </div>

          <div className="card pad0">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Device / IP cluster</h3><span className="sub">3 accounts share this fingerprint</span></div>
            <table>
              <thead><tr><th>Account</th><th>Device fingerprint</th><th>IP range</th><th>Tier</th><th>Last seen</th></tr></thead>
              <tbody>
                {cluster.map((c) => (
                  <tr key={c.id} className="clickable">
                    <td><Link href={`/users/${c.id}`}><span className="t">{c.acct}</span></Link></td>
                    <td><span className="mono">{c.device}</span></td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{c.ip}</span></td>
                    <td><span className="tag st-blue">{c.tier}</span></td>
                    <td className="sub">{c.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Tier</span><span style={{ fontWeight: 600 }}>{u.tier}</span></div>
              <div className="r"><span className="k2">Risk</span><span style={{ fontWeight: 700, color: riskColor(u.risk) }}>{u.risk}</span></div>
              <div className="r"><span className="k2">First seen</span><span>14 days ago</span></div>
              <div className="r"><span className="k2">Signups / device</span><span style={{ fontWeight: 700 }}>4</span></div>
            </div>
          </div>
          <LinksPanel edges={edges} />
        </div>
      </div>
    </div>
  );
}
