import '../alerts/signals.css';
import { requireSectionPage } from '@/lib/auth';
import { getActivity, type ActivityEvent } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Activity. A vertical timeline feed of recent estate events
// (tickets, findings, scans) assembled from the ops tables by getActivity().
// Renders inside the v2 shell (.v2-shell > .v2-content); this file supplies page
// content only. Shares the `v2-sig-*` styling in ../alerts/signals.css with the
// Alerts page. When there's no DB / no events yet, an honest empty state renders
// instead of fabricated sample rows.

// Derive a colour tone for the timeline dot from the event when it doesn't carry
// one explicitly (getActivity always sets one, but keep the fallback robust).
function toneFor(item: ActivityEvent): string {
  if (item.tone) return item.tone;
  const t = item.text.toLowerCase();
  if (/(finding|sec-|abuse|vuln|security|incident|inc-)/.test(t)) return 'security';
  if (/(scan|deploy|release|rel-|container|infra|capacity)/.test(t)) return 'ops';
  if (/(ticket|ops-|comment|assign)/.test(t)) return 'support';
  if (/(fixed|resolved|complete|done)/.test(t)) return 'ok';
  return '';
}

export default async function V2ActivityPage() {
  await requireSectionPage('operations');

  const { rows: feed, live } = await getActivity();

  return (
    <div>
      {/* Header */}
      <div className="v2-sig-head">
        <div className="v2-eyebrow">Operations · Signals</div>
        <h1 className="v2-h1">Activity</h1>
        <div className="v2-sub">Recent events across findings, tickets, scans and deploys</div>
      </div>

      {/* Timeline feed */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>Recent activity</h3>
          <span className="v2-link">{feed.length} events{live ? '' : ' · offline'}</span>
        </div>

        {feed.length === 0 ? (
          <div style={{ padding: '28px 16px', color: 'var(--muted)', fontSize: 13 }}>
            No recent activity yet. Events appear here as tickets are opened, findings are
            raised and scans run.
          </div>
        ) : (
          <div className="v2-sig-feed">
            {feed.map((item, i) => (
              <div className="v2-sig-item" key={i}>
                <span className={`v2-sig-dot ${toneFor(item)}`} aria-hidden>{item.icon}</span>
                <span className="v2-sig-txt">{item.text}</span>
                <span className="v2-sig-time">{item.when}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
