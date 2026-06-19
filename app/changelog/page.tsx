import { getChangelog } from '@/lib/data';
import { requireGlobalAdminPage } from '@/lib/auth';
import { LiveBadge } from '@/components/LiveBadge';
import { AppTag } from '@/components/AppTag';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

export default async function ChangelogPage() {
  await requireGlobalAdminPage();
  const { rows, live, note } = await getChangelog();

  return (
    <div>
      <AutoRefresh source="changelog" />
      <div className="spread mb">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="h1">Changelog</div>
            <LiveBadge live={live} table="ops.changelog_entries" note={note} />
          </div>
          <div className="sub">Shipped across the estate · written when roadmap items reach Shipped</div>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 && <div className="sub">No entries yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {rows.map((e, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 80, flexShrink: 0 }}>
                <div className="mono" style={{ color: '#7fa8ff' }}>{e.version || '—'}</div>
                <div className="sub" style={{ fontSize: 11 }}>{new Date(e.date).toLocaleDateString()}</div>
              </div>
              <div style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ fontSize: 13.5 }}>{e.label}</b>
                  <AppTag app={e.app} />
                </div>
                <div style={{ color: '#c8cedb', fontSize: 12.5, marginTop: 4 }}>{e.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
