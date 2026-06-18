import Link from 'next/link';

const caps = [
  ['View', true, true, true],
  ['Triage findings', false, true, true],
  ['Comment tickets', false, true, true],
  ['Run scans', false, true, true],
  ['Container actions', false, false, true],
  ['Edit rules', false, false, true],
  ['Manage channels', false, false, true],
] as const;

const members = [
  { name: 'Ben Percival', email: 'bpercival92@gmail.com', role: ['st-blue', 'ops_admin'], active: 'now' },
  { name: 'Lewis Hart', email: 'lewis@bentech.dev', role: ['st-prog', 'ops_responder'], active: '12m ago' },
  { name: 'Mara Quinn', email: 'mara@bentech.dev', role: ['st-prog', 'ops_responder'], active: '3h ago' },
  { name: 'Audit Bot', email: 'audit@bentech.dev', role: ['st-mute', 'ops_viewer'], active: '1d ago' },
];

const cell = (v: boolean) => (v ? <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓</span> : <span className="sub">—</span>);

export default function RolesPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Roles &amp; access</div><div className="sub">Capability matrix and console membership</div></div>
      </div>

      <div className="card pad0 mb">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Capability matrix</h3></div>
        <table>
          <thead><tr><th>Capability</th><th>ops_viewer</th><th>ops_responder</th><th>ops_admin</th></tr></thead>
          <tbody>
            {caps.map((r) => (
              <tr key={r[0] as string}>
                <td className="t" style={{ fontWeight: 700 }}>{r[0]}</td>
                <td>{cell(r[1] as boolean)}</td>
                <td>{cell(r[2] as boolean)}</td>
                <td>{cell(r[3] as boolean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card pad0">
        <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Console members</h3><button className="btn ghost sm">+ Invite</button></div>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last active</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.email}>
                <td className="t" style={{ fontWeight: 700 }}>{m.name}</td>
                <td><span className="mono">{m.email}</span></td>
                <td><span className={`tag ${m.role[0]}`}>{m.role[1]}</span></td>
                <td className="sub">{m.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt sub"><Link className="link" href="/settings">← Back to settings</Link></div>
    </div>
  );
}
