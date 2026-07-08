import '../alerts/signals.css';
import { requireSectionPage } from '@/lib/auth';
import { activity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Activity. A vertical timeline feed of recent estate events
// (deploys, incidents, tickets, scans). Renders inside the v2 shell
// (.v2-shell > .v2-content); this file supplies page content only. Shares the
// `v2-sig-*` styling in ../alerts/signals.css with the Alerts page.

type Feed = { icon: string; text: string; when: string; tone?: string };

// Prefer the shared mock feed when present; otherwise fall back to a static set
// so the page always renders without a data source.
const FALLBACK: Feed[] = [
  { icon: '🚀', text: 'Release REL-0001 (Sentinel v0.4) deployed to production', when: '9 min ago', tone: 'ok' },
  { icon: '⟳', text: 'Automated scan suite completed — 3 new findings', when: '14 min ago', tone: 'ops' },
  { icon: '⚑', text: 'Incident INC-0001 opened — transcription queue backed up', when: '32 min ago', tone: 'security' },
  { icon: '🎫', text: 'Ticket OPS-0006 assigned to ben', when: '1h ago', tone: 'support' },
  { icon: '🛡', text: 'Anti-abuse flagged 2 accounts sharing a device fingerprint', when: '3h ago', tone: 'security' },
  { icon: '✓', text: 'Change CHG-003 (rotate leaked service-role key) implemented', when: '5h ago', tone: 'ok' },
  { icon: '🎫', text: 'Ticket OPS-0005 commented by ben', when: '7h ago', tone: 'support' },
  { icon: '✓', text: 'Finding SEC-0001 marked Fixed', when: '1d ago', tone: 'ok' },
];

const feed: Feed[] =
  Array.isArray(activity) && activity.length > 0 ? (activity as Feed[]) : FALLBACK;

// Derive a colour tone for the timeline dot from the event text when the item
// doesn't carry one explicitly.
function toneFor(item: Feed): string {
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
          <span className="v2-link">{feed.length} events</span>
        </div>

        <div className="v2-sig-feed">
          {feed.map((item, i) => (
            <div className="v2-sig-item" key={i}>
              <span className={`v2-sig-dot ${toneFor(item)}`} aria-hidden>{item.icon}</span>
              <span className="v2-sig-txt">{item.text}</span>
              <span className="v2-sig-time">{item.when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
