import Link from 'next/link';
import { notFound } from 'next/navigation';
import { rules } from '@/lib/mock';
import { requireGlobalAdminPage } from '@/lib/auth';

const field: React.CSSProperties = {
  width: '100%', background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 10,
  padding: '10px 12px', color: 'var(--text)', fontSize: 13,
};

export default async function RuleEditor({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;
  const r = rules.find((x) => x.id === id);
  if (!r) return notFound();

  const sample = JSON.stringify(
    { id: r.id, enabled: r.enabled, when: { match: r.trigger }, then: r.action.split(' · ').map((a) => ({ do: a.trim() })) },
    null, 2,
  );

  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/alerts/rules">Rules</Link> · <b>{r.name}</b></div>
        <div className="row"><button className="btn ghost sm">Disable</button><button className="btn sm">Save rule</button></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 360px' }}>
        <div>
          <div className="card mb">
            <div className="panel-h"><h3>Trigger</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 6 }}>
              <label>
                <div className="k2" style={{ marginBottom: 6 }}>Event</div>
                <select style={field} defaultValue="finding.created">
                  <option value="finding.created">finding.created</option>
                  <option value="finding.updated">finding.updated</option>
                  <option value="metric.threshold">metric.threshold</option>
                  <option value="abuse.cluster">abuse.cluster</option>
                </select>
              </label>
              <label>
                <div className="k2" style={{ marginBottom: 6 }}>Conditions</div>
                <input style={field} defaultValue={r.trigger} />
              </label>
            </div>
          </div>

          <div className="card">
            <div className="panel-h"><h3>Action</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
              <Toggle label="Notify Slack" on={r.action.includes('notify') || r.action.includes('slack')} />
              <Toggle label="Send email" on={r.action.includes('email')} />
              <Toggle label="Raise ticket" on={r.action.includes('ticket')} />
              <Toggle label="Escalate / page" on={r.action.includes('escalate') || r.action.includes('page')} />
            </div>
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="panel-h"><h3>Definition</h3><span className="sub">json</span></div>
          <pre style={{ background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 12, color: '#c8cedb', overflow: 'auto' }}><code>{sample}</code></pre>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="row spread">
      <span style={{ fontSize: 13 }}>{label}</span>
      <span className={`tag ${on ? 'st-done' : 'st-mute'}`}>{on ? 'On' : 'Off'}</span>
    </div>
  );
}
