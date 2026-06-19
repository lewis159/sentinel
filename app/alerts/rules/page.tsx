import Link from 'next/link';
import { rules } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

export default async function RulesPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/alerts">Alerts</Link> · <b>Rules</b></div>
        <button className="btn sm">+ New rule</button>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Rule</th><th>State</th><th>Trigger</th><th>Action</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="clickable">
                <td><Link href={`/alerts/rules/${r.id}`}><div className="t">{r.name}</div></Link></td>
                <td><span className={`pill ${r.enabled ? 'sev-low' : 'sev-info'}`}>● {r.enabled ? 'On' : 'Off'}</span></td>
                <td><span className="mono" style={{ fontSize: 11 }}>{r.trigger}</span></td>
                <td className="sub">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
