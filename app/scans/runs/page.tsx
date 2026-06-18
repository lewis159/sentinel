import Link from 'next/link';
import { scanRuns } from '@/lib/mock';

const statusTag: Record<string, [string, string]> = {
  complete: ['st-done', 'Complete'], running: ['st-done', 'Running'], failed: ['st-open', 'Failed'],
};

export default function ScanRunsPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Scan runs</div><div className="sub">{scanRuns.length} recent runs · all checks</div></div>
        <Link className="link" href="/scans">← Back to checks</Link>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Run</th><th>Type</th><th>Findings</th><th>Status</th><th>Duration</th><th>When</th></tr></thead>
          <tbody>
            {scanRuns.map((r) => {
              const [cls, lab] = statusTag[r.status] ?? ['st-mute', r.status];
              return (
                <tr key={r.id} className="clickable">
                  <td><Link href={`/scans/runs/${r.id}`}><span className="mono">#{r.id}</span></Link></td>
                  <td>{r.type}</td>
                  <td><span className="tag st-blue">{r.findings}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td className="mono">{r.duration}</td>
                  <td className="sub">{r.when}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
