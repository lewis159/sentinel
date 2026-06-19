import { sevClass, sevLabel, KIND_LABEL, type ServiceTicket } from '@/lib/mock';
import { AppTag } from './AppTag';
import { TicketControls } from './TicketControls';

const statusColor: Record<string, string> = {
  open: '#7fa8ff', draft: '#aab3c4', in_progress: '#ffc05a', investigating: '#ffc05a',
  awaiting_cab: '#ffc05a', building: '#ffc05a', planned: '#7fa8ff', scheduled: '#7fa8ff',
  blocked: 'var(--muted)', approved: '#5fd49b', implemented: '#5fd49b', deployed: '#5fd49b',
  verified: '#5fd49b', fulfilled: '#5fd49b', known_error: '#ff8b8e', resolved: '#5fd49b',
  staged: '#7fa8ff', closed: 'var(--muted)',
};

// Renders the ITIL field set for one record. The kind-specific block (change /
// problem / release) is driven off `attrs`.
export function TicketDetail({ t }: { t: ServiceTicket }) {
  return (
    <div>
      <div className="card mb">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span className="tag st-blue">{KIND_LABEL[t.kind] ?? t.kind}</span>
          <AppTag app={t.app} />
          <span className={`pill ${sevClass[t.priority]}`}>● {sevLabel[t.priority]} priority</span>
        </div>
        <div className="h1" style={{ margin: '4px 0 6px' }}>{t.title}</div>
        <p style={{ color: '#c8cedb', lineHeight: 1.7 }}>{t.description}</p>
      </div>

      <div className="card mb">
        <div className="kv">
          <div className="r"><span className="k2">Ref</span><span className="mono">{t.ref}</span></div>
          <div className="r"><span className="k2">Status</span><span style={{ fontWeight: 600, color: statusColor[t.status] ?? 'var(--text)' }}>{t.status}</span></div>
          <div className="r"><span className="k2">Impact × Urgency → Priority</span><span>{t.impact} × {t.urgency} → <b>{sevLabel[t.priority]}</b></span></div>
          <div className="r"><span className="k2">App</span><span><AppTag app={t.app} /></span></div>
          <div className="r"><span className="k2">Assignee</span><span>{t.assignee}</span></div>
          <div className="r"><span className="k2">Source</span><span>{t.source}</span></div>
          <div className="r"><span className="k2">SLA due</span><span style={{ color: t.slaDue ? '#ffc05a' : 'var(--muted)' }}>{t.slaDue ? new Date(t.slaDue).toLocaleString() : '—'}</span></div>
        </div>
      </div>

      <TicketControls ref_={t.ref} kind={t.kind} status={t.status} assignee={t.assignee} />

      <KindAttrs t={t} />
    </div>
  );
}

function KindAttrs({ t }: { t: ServiceTicket }) {
  const a = t.attrs ?? {};
  if (t.kind === 'change') {
    return (
      <div className="card mb">
        <div className="panel-h"><h3>Change details</h3></div>
        <div className="kv">
          <div className="r"><span className="k2">Change type</span><span>{a.change_type ?? '—'}</span></div>
          <div className="r"><span className="k2">Risk</span><span>{a.risk ?? '—'}</span></div>
          <div className="r"><span className="k2">CAB status</span><span>{a.cab_status ?? '—'}</span></div>
          <div className="r"><span className="k2">Window</span><span>{a.window ?? '—'}</span></div>
          <div className="r"><span className="k2">Backout plan</span><span>{a.backout ?? '—'}</span></div>
        </div>
      </div>
    );
  }
  if (t.kind === 'problem') {
    return (
      <div className="card mb">
        <div className="panel-h"><h3>Problem details</h3></div>
        <div className="kv">
          <div className="r"><span className="k2">Root cause</span><span>{a.root_cause ?? '—'}</span></div>
          <div className="r"><span className="k2">Known error</span><span>{a.known_error ? 'Yes' : 'No'}</span></div>
          <div className="r"><span className="k2">Workaround</span><span>{a.workaround ?? '—'}</span></div>
        </div>
      </div>
    );
  }
  if (t.kind === 'release') {
    const changes: string[] = Array.isArray(a.linked_changes) ? a.linked_changes : [];
    return (
      <div className="card mb">
        <div className="panel-h"><h3>Release details</h3></div>
        <div className="kv">
          <div className="r"><span className="k2">Version</span><span className="mono">{a.version ?? '—'}</span></div>
          <div className="r"><span className="k2">Window</span><span>{a.window ?? '—'}</span></div>
          <div className="r"><span className="k2">Linked changes</span><span>{changes.length ? changes.join(', ') : '—'}</span></div>
        </div>
      </div>
    );
  }
  return null;
}
