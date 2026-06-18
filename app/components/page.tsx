import Link from 'next/link';
import { components } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

const kindTag: Record<string, string> = {
  service: 'st-blue', infra: 'st-mute', route: 'st-prog',
};

export default async function ComponentsPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div><div className="h1">Components</div><div className="sub">{components.length} components · services, infra and routes</div></div>
      </div>

      <div className="card pad0">
        <table>
          <thead><tr><th>Key</th><th>Name</th><th>Kind</th><th>Findings</th><th>Containers</th></tr></thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.key} className="clickable">
                <td><Link href={`/components/${c.key}`}><span className="mono">{c.key}</span></Link></td>
                <td><div className="t">{c.name}</div></td>
                <td><span className={`tag ${kindTag[c.kind] ?? 'st-mute'}`}>{c.kind}</span></td>
                <td style={{ fontWeight: 700, color: c.findings > 0 ? '#ff8b8e' : 'var(--muted)' }}>{c.findings}</td>
                <td style={{ fontWeight: 700 }}>{c.containers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
