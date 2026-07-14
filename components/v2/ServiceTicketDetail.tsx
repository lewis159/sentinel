// Shared ITIL DETAIL view — one reusable pane for the request / problem /
// release detail routes. Server component: fetches its own record via
// getServiceTicket(ref) (DB-first with a mock fallback), the activity timeline
// via getTicketComments(ref) and linked records via getTicketEdges(ref). Renders
// a "not found" card when the ref doesn't resolve so the route never 404s.
// Styling lives in app/v2/requests/[ref]/detail.css (namespaced v2-st-*); shared
// card/pill/button classes and colour tokens come from v2.css.

import Link from 'next/link';
import { getServiceTicket, getTicketComments, getTicketEdges } from '@/lib/data';
import type { Severity } from '@/lib/mock';
import { KIND_LABEL } from '@/lib/mock';
import { TicketComposer, TicketStatusControl } from '@/components/v2/ticket-actions';
import HermesPanel from '@/components/v2/HermesPanel';
import '@/app/v2/requests/[ref]/detail.css';

type Kind = 'request' | 'problem' | 'release' | 'incident' | 'change';

type Props = {
  refId: string;
  kind: Kind;
};

// Map a ticket priority band onto the v2-pill variant classes (crit/high/info).
function priorityClass(priority: Severity | string): 'crit' | 'high' | 'info' {
  if (priority === 'critical') return 'crit';
  if (priority === 'high') return 'high';
  return 'info';
}

// Relative time for the timeline (mirrors lib/data's private rel()).
function rel(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Absolute-ish SLA due rendering — a short date, or "—" when unset.
function slaLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function humanize(v: string): string {
  return (v ?? '').toString().replace(/_/g, ' ');
}

export default async function ServiceTicketDetail({ refId, kind }: Props) {
  const kindLabel = KIND_LABEL[kind] ?? kind;
  const { row } = await getServiceTicket(refId);

  // ---- Graceful not-found card (route stays 200, no 404) ----
  if (!row) {
    return (
      <div className="v2-st-page">
        <div className="v2-eyebrow">{kindLabel} · Service management</div>
        <div className="v2-card v2-st-notfound">
          <h2>{kindLabel} not found</h2>
          <p>
            No {kind} matches <code>{refId}</code>. It may have been closed, merged, or the reference
            is mistyped.
          </p>
        </div>
      </div>
    );
  }

  const [comments, edges] = await Promise.all([
    getTicketComments(refId),
    getTicketEdges(refId),
  ]);

  const attrEntries = Object.entries(row.attrs ?? {}).filter(
    ([k]) => k !== 'assignee', // assignee already surfaced in the header/meta
  );

  return (
    <div className="v2-st-page">
      {/* ---------- Header ---------- */}
      <div className="v2-st-head">
        <div className="v2-st-head-main">
          <div className="v2-eyebrow">{kindLabel} · Service management</div>
          <span className={`v2-pill ${priorityClass(row.priority)}`} style={{ marginTop: 8, marginBottom: 8 }}>
            {row.priority}
          </span>
          <h1 className="v2-h1">
            {row.ref} · {row.title}
          </h1>
          <div className="v2-st-meta">
            <span>{kindLabel}</span>
            <span>·</span>
            <TicketStatusControl refId={row.ref} kind={kind} status={row.status} />
            <span>·</span>
            <span>{row.app}</span>
            <span>·</span>
            <span>
              assignee: <b>{row.assignee}</b>
            </span>
            <span>·</span>
            <span>{row.age} old</span>
          </div>
        </div>
        <div className="v2-st-head-actions">
          <button className="v2-btn ghost">Update</button>
          <button className="v2-btn">Resolve</button>
        </div>
      </div>

      {/* ---------- Status strip ---------- */}
      <div className="v2-st-strip">
        <div className="v2-st-sc">
          <div className="k">Priority</div>
          <div className="v">{row.priority}</div>
        </div>
        <div className="v2-st-sc">
          <div className="k">Impact</div>
          <div className="v">{row.impact}</div>
        </div>
        <div className="v2-st-sc">
          <div className="k">Urgency</div>
          <div className="v">{row.urgency}</div>
        </div>
        <div className="v2-st-sc">
          <div className="k">SLA due</div>
          <div className="v" style={{ textTransform: 'none' }}>
            {slaLabel(row.slaDue)}
          </div>
        </div>
      </div>

      {/* ---------- Two-column grid ---------- */}
      <div className="v2-st-grid">
        {/* ===== LEFT — Timeline ===== */}
        <div className="v2-st-col">
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Timeline</h3>
            </div>
            {comments.length === 0 ? (
              <div className="v2-st-empty">No updates yet.</div>
            ) : (
              <div className="v2-st-tl">
                {comments.map((c) => (
                  <div key={c.id} className="v2-st-ev">
                    <span className="v2-st-ev-dot" />
                    <div className="v2-st-ev-body">
                      <div className="v2-st-ev-head">
                        <span className="v2-st-ev-author">{c.author}</span>
                        {c.kind && c.kind !== 'comment' && (
                          <span className="v2-st-ev-kind">{c.kind}</span>
                        )}
                        <span className="v2-st-ev-time">{rel(c.createdAt)}</span>
                      </div>
                      <div className="v2-st-ev-txt">{c.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <TicketComposer refId={row.ref} />
          </div>
        </div>

        {/* ===== RIGHT ===== */}
        <div className="v2-st-col">
          {/* Hermes copilot draft panel — incident assessment for incidents,
              support draft otherwise. */}
          <HermesPanel refId={row.ref} agent={kind === 'incident' ? 'incident' : undefined} />

          {/* Linked records */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Linked records</h3>
            </div>
            {edges.length === 0 ? (
              <div className="v2-st-empty">No linked records.</div>
            ) : (
              <div className="v2-st-link-list">
                {edges.map((e, i) => (
                  <Link key={`${e.type}:${e.id}:${i}`} href={e.href} className="v2-st-link">
                    <div className="v2-st-link-main">
                      <div className="v2-st-link-id">{e.label || e.id}</div>
                      <div className="v2-st-link-sub">{humanize(e.rel)}</div>
                    </div>
                    <span className="v2-st-link-kind">{e.type}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Details</h3>
            </div>
            <div className="v2-st-details">
              <div className="v2-st-desc">{row.description || 'No description provided.'}</div>
              <dl className="v2-st-attrs">
                <dt>Kind</dt>
                <dd>{kindLabel}</dd>
                <dt>App</dt>
                <dd>{row.app}</dd>
                <dt>Source</dt>
                <dd>{row.source}</dd>
                <dt>Assignee</dt>
                <dd>{row.assignee}</dd>
                {attrEntries.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{humanize(k)}</dt>
                    <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
