import Link from 'next/link';
import { notFound } from 'next/navigation';
import { incidents, sevClass, sevLabel } from '@/lib/mock';
import { LinksPanel, type Edge } from '@/components/LinksPanel';
import { requireGlobalAdminPage } from '@/lib/auth';

const statusTag: Record<string, [string, string]> = {
  open: ['st-open', 'Open'], in_progress: ['st-prog', 'In progress'], resolved: ['st-done', 'Resolved'],
};

const timeline = [
  { icon: '🚨', text: 'Incident declared from correlated alerts.', when: '2d ago' },
  { icon: '👤', text: 'ben assigned as incident commander.', when: '2d ago' },
  { icon: '🎫', text: 'Linked ticket OPS-0007 opened for remediation.', when: '2d ago' },
  { icon: '💬', text: 'Mitigation in progress — read-only socket proxy under test.', when: '4h ago' },
];

const linkedItems = [
  { id: 'SEC-0009', label: 'Exposed Docker socket', href: '/findings/SEC-0009', kind: 'finding' },
  { id: 'OPS-0007', label: 'Harden Docker socket', href: '/tickets/OPS-0007', kind: 'ticket' },
];

export default async function IncidentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;
  const inc = incidents.find((x) => x.id === id);
  if (!inc) return notFound();
  const [cls, lab] = statusTag[inc.status] ?? ['st-mute', inc.status];

  const edges: Edge[] = [
    { rel: 'includes', type: 'finding', id: 'SEC-0009', label: 'Exposed Docker socket', href: '/findings/SEC-0009' },
    { rel: 'remediation', type: 'ticket', id: 'OPS-0007', label: 'Harden Docker socket', href: '/tickets/OPS-0007' },
  ];

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/incidents">Incidents</Link> · <b>{inc.id}</b></div>
        <div className="row"><button className="btn ghost sm">Add item</button><button className="btn sm">Resolve incident</button></div>
      </div>

      <div className="card mb">
        <span className={`pill ${sevClass[inc.severity]}`}>● {sevLabel[inc.severity]}</span>
        <div className="h1" style={{ margin: '12px 0 6px' }}>{inc.title}</div>
        <div className="row wrap sub" style={{ gap: 16 }}>
          <span>ID <b style={{ color: 'var(--text)' }}>{inc.id}</b></span>
          <span>Status <span className={`tag ${cls}`}>{lab}</span></span>
          <span>Items <b style={{ color: 'var(--text)' }}>{inc.items}</b></span>
          <span>Opened <b style={{ color: 'var(--text)' }}>{inc.opened}</b></span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card mb">
            <div className="panel-h"><h3>Timeline</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {timeline.map((e, i) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12 }}>{e.icon}</div>
                  <div><div style={{ fontSize: 12.5 }}>{e.text}</div><div className="sub" style={{ fontSize: 11 }}>{e.when}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card pad0">
            <div className="panel-h" style={{ padding: '16px 16px 0' }}><h3>Linked items</h3></div>
            <table>
              <thead><tr><th>Ref</th><th>Item</th><th>Type</th></tr></thead>
              <tbody>
                {linkedItems.map((it) => (
                  <tr key={it.id} className="clickable">
                    <td><Link href={it.href}><span className="mono">{it.id}</span></Link></td>
                    <td><Link href={it.href}><div className="t">{it.label}</div></Link></td>
                    <td><span className="tag st-blue">{it.kind}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="kv">
              <div className="r"><span className="k2">Severity</span><span style={{ fontWeight: 700 }}>{sevLabel[inc.severity]}</span></div>
              <div className="r"><span className="k2">Status</span><span>{inc.status}</span></div>
              <div className="r"><span className="k2">Commander</span><span>ben</span></div>
              <div className="r"><span className="k2">Items</span><span>{inc.items}</span></div>
              <div className="r"><span className="k2">Opened</span><span>{inc.opened}</span></div>
            </div>
          </div>
          <LinksPanel edges={edges} />
        </div>
      </div>
    </div>
  );
}
