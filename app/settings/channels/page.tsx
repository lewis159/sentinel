import Link from 'next/link';

const channels = [
  { icon: '✉️', name: 'Email', target: 'sec-alerts@bentech.dev', on: true },
  { icon: '💬', name: 'Slack', target: '#sec', on: true },
  { icon: '📨', name: 'Telegram', target: '@sentinel_ops_bot', on: false },
  { icon: '🪝', name: 'Generic webhook', target: 'https://hooks.bentech.dev/sentinel', on: true },
];

export default function ChannelsPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Notification channels</div><div className="sub">Where Sentinel delivers alerts and digests</div></div>
        <button className="btn">+ Add channel</button>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Channel</th><th>Target</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.name}>
                <td><div className="row" style={{ gap: 10 }}><span>{c.icon}</span><span className="t" style={{ fontWeight: 700 }}>{c.name}</span></div></td>
                <td><span className="mono">{c.target}</span></td>
                <td><span className={`tag ${c.on ? 'st-done' : 'st-mute'}`}>{c.on ? 'On' : 'Off'}</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn ghost sm">Configure</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt sub"><Link className="link" href="/settings">← Back to settings</Link></div>
    </div>
  );
}
