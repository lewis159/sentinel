import Link from 'next/link';
import { checks } from '@/lib/mock';

const nextRun: Record<string, string> = {
  'npm-audit': 'tonight 02:00',
  'gitleaks': 'on next push',
  'trivy': 'on next build',
  'headers': 'in 3h',
  'access-audit': 'tomorrow 06:00',
  'abuse': 'in 52m',
  'capacity': 'in 20s',
  'uptime': 'in 10s',
};

export default function SchedulesPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Scan schedules</div><div className="sub">{checks.length} automated checks · cadence and run windows</div></div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Check</th><th>Schedule</th><th>Last run</th><th>Next run</th><th>Enabled</th><th></th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td><div className="t" style={{ fontWeight: 700 }}>{c.name}</div><div className="d"><span className="mono">{c.source}</span></div></td>
                <td>{c.schedule}</td>
                <td className="sub">{c.lastRun}</td>
                <td className="sub">{nextRun[c.key] ?? '—'}</td>
                <td><span className="tag st-done">Enabled</span></td>
                <td style={{ textAlign: 'right' }}><button className="btn ghost sm">Edit schedule</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt sub"><Link className="link" href="/settings">← Back to settings</Link></div>
    </div>
  );
}
