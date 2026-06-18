import Link from 'next/link';
import { incidents, sevClass, sevLabel } from '@/lib/mock';

const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], resolved: ['st-done', 'Resolved'],
};

export default function IncidentsPage() {
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Incidents</div><div className="sub">{incidents.filter((i) => i.status === 'open').length} open</div></div>
        <button className="btn sm">+ Declare incident</button>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Items</th><th>Opened</th></tr></thead>
          <tbody>
            {incidents.map((i) => {
              const [cls, lab] = statusTag[i.status] ?? ['st-mute', i.status];
              return (
                <tr key={i.id} className="clickable">
                  <td><Link href={`/incidents/${i.id}`}><span className="mono">{i.id}</span></Link></td>
                  <td><Link href={`/incidents/${i.id}`}><div className="t">{i.title}</div></Link></td>
                  <td><span className={`pill ${sevClass[i.severity]}`}>● {sevLabel[i.severity]}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td><span className="tag st-blue">{i.items}</span></td>
                  <td className="sub">{i.opened}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
