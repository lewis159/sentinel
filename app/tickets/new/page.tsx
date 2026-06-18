import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';

const field: React.CSSProperties = {
  width: '100%', background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 10,
  padding: '10px 12px', color: 'var(--text)', fontSize: 13,
};

export default async function NewTicketPage() {
  await requireGlobalAdminPage();
  return (
    <div>
      <div className="spread mb">
        <div className="crumb"><Link className="link" href="/tickets">Tickets</Link> · <b>New</b></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div className="card">
          <div className="panel-h"><h3>Create ticket</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 6 }}>
            <label>
              <div className="k2" style={{ marginBottom: 6 }}>Title</div>
              <input style={field} placeholder="Short summary of the work…" />
            </label>

            <div className="row" style={{ gap: 14 }}>
              <label style={{ flex: 1 }}>
                <div className="k2" style={{ marginBottom: 6 }}>Type</div>
                <select style={field} defaultValue="security">
                  <option value="security">Security</option>
                  <option value="infra">Infra</option>
                  <option value="task">Task</option>
                </select>
              </label>
              <label style={{ flex: 1 }}>
                <div className="k2" style={{ marginBottom: 6 }}>Priority</div>
                <select style={field} defaultValue="medium">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
            </div>

            <label>
              <div className="k2" style={{ marginBottom: 6 }}>Description</div>
              <textarea style={{ ...field, minHeight: 140, resize: 'vertical' }} placeholder="Context, affected components, acceptance criteria…" />
            </label>

            <div className="row spread">
              <Link className="btn ghost" href="/tickets">Cancel</Link>
              <button className="btn">Create ticket</button>
            </div>
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="panel-h"><h3>Tips</h3></div>
          <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: '#c8cedb', fontSize: 12.5 }}>
            <li>Link a finding to auto-populate severity and component.</li>
            <li>High+ priority tickets start an SLA clock on assignment.</li>
            <li>Unowned tickets are surfaced by the escalation rules.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
