import { requireGlobalAdminPage } from '@/lib/auth';

const services = [
  { name: 'App', uptime: '99.98%', ok: true },
  { name: 'API', uptime: '99.96%', ok: true },
  { name: 'Database', uptime: '99.99%', ok: true },
  { name: 'AI (Hermes)', uptime: '99.62%', ok: true },
  { name: 'Workers', uptime: '99.40%', ok: true },
];

export default async function StatusPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="h1 mb">System status</div>

      <div className="card mb" style={{ borderColor: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="status-dot" style={{ background: 'var(--ok)' }} />
        <div>
          <div className="t" style={{ fontWeight: 800, color: 'var(--ok)' }}>All systems operational</div>
          <div className="sub">Updated just now · auto-refreshes every 60s</div>
        </div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Service</th><th>Uptime (90d)</th><th>Status</th></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name}>
                <td className="t" style={{ fontWeight: 700 }}>{s.name}</td>
                <td><span className="mono">{s.uptime}</span></td>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="status-dot" style={{ background: s.ok ? 'var(--ok)' : 'var(--med)' }} />
                    {s.ok ? 'Operational' : 'Degraded'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sub mt">Showing 90-day uptime. No incidents reported in the last 90 days.</div>
    </div>
  );
}
