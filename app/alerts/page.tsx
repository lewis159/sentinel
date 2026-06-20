import Link from 'next/link';
import { getAlerts } from '@/lib/data';
import { sevClass, sevLabel } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

const statusTag: Record<string, [string, string]> = {
  firing: ['st-open', 'Firing'], acknowledged: ['st-mute', 'Acknowledged'], resolved: ['st-done', 'Resolved'],
};

export default async function AlertsPage() {
  await requireGlobalAdminPage();
  const { rows: alerts, live, note } = await getAlerts();
  return (
    <div>
      <AutoRefresh source="alerts" />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Alerts</div>
            <span className={`pill live-badge${live ? '' : ' mock'}`}>
              <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
              {live ? 'LIVE · ops.alerts' : `mock${note ? ' · ' + note : ''}`}
            </span>
          </div>
          <div className="sub">{alerts.filter((a) => a.status === 'firing').length} firing · {alerts.length} total</div>
        </div>
        <div className="row"><button className="btn ghost sm">Acknowledge all</button><Link className="btn sm" href="/alerts/rules">Rules →</Link></div>
      </div>

      <div className="row wrap mb" style={{ gap: 8 }}>
        <div className="search" style={{ flex: 1, minWidth: 240 }}>🔍 Search alerts, rules…</div>
        <div className="chip on">Firing</div><div className="chip">Acknowledged</div><div className="chip">Resolved</div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Severity</th><th>Alert</th><th>Rule</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {alerts.map((a) => {
              const [cls, lab] = statusTag[a.status] ?? ['st-mute', a.status];
              return (
                <tr key={a.id} className="clickable">
                  <td><span className={`pill ${sevClass[a.severity]}`}>● {sevLabel[a.severity]}</span></td>
                  <td><div className="t">{a.message}</div></td>
                  <td><span className="mono" style={{ fontSize: 11 }}>{a.rule}</span></td>
                  <td><span className={`tag ${cls}`}>{lab}</span></td>
                  <td className="sub">{a.when}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
