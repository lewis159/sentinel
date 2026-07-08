import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import HermesPanel from '@/components/v2/HermesPanel';
import { getOneFinding, getFindingEdges } from '@/lib/data';
import './finding.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Security finding detail — server component. Loads one finding from
// ops.findings (mock fallback) and surfaces the Hermes · Security agent in the
// right rail so an operator can get an assessment + remediation recommendation
// without leaving the finding. Linked records come from the ops.links graph.
// ---------------------------------------------------------------------------

// Finding severity → shell pill class. medium reads as an info-toned pill and
// low as an ok-toned one, matching the security board's convention.
const PILL: Record<string, string> = {
  critical: 'crit',
  high: 'high',
  medium: 'info',
  low: 'ok',
};

function pillClass(severity: string): string {
  return PILL[severity] ?? 'info';
}

// Map an edge's node type to a human label for the linked-records rows.
const EDGE_KIND: Record<string, string> = {
  finding: 'Finding',
  ticket: 'Ticket',
  component: 'Component',
  kb: 'KB article',
  container: 'Container',
  scan: 'Scan',
  alert: 'Alert',
  user: 'User',
};

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  await requireSectionPage('security');
  const { ref } = await params;

  const { row: finding } = await getOneFinding(ref);

  // Graceful not-found — the section is still gated above, so this only renders
  // for a valid operator hitting a ref with no matching finding.
  if (!finding) {
    return (
      <div className="v2-fd-page">
        <div className="v2-fd-head">
          <div className="v2-eyebrow">Security · Finding</div>
          <h1 className="v2-h1">{ref}</h1>
        </div>
        <div className="v2-card">
          <div className="v2-fd-empty">Finding {ref} not found.</div>
        </div>
      </div>
    );
  }

  const edges = await getFindingEdges(ref);

  const metaParts: Array<{ k: string; v: string }> = [
    { k: 'Component', v: finding.component || '—' },
    { k: 'CWE', v: finding.cwe || '—' },
    { k: 'CVSS', v: finding.cvss ? String(finding.cvss) : '—' },
    { k: 'Source', v: finding.source || '—' },
    { k: 'Status', v: finding.status || '—' },
  ];

  return (
    <div className="v2-fd-page">
      {/* ---------- Header ---------- */}
      <div className="v2-fd-head">
        <div className="v2-eyebrow">Security · Finding</div>
        <span className={`v2-pill ${pillClass(finding.severity)}`} style={{ alignSelf: 'flex-start' }}>
          {finding.severity}
        </span>
        <h1 className="v2-h1">
          {finding.ref} · {finding.title}
        </h1>
        <div className="v2-fd-meta">
          <b>{finding.component || '—'}</b>
          {finding.cwe && (<><span>·</span><span>{finding.cwe}</span></>)}
          <span>·</span>
          <span>CVSS {finding.cvss || '—'}</span>
          <span>·</span>
          <span>{finding.source || '—'}</span>
          <span>·</span>
          <span>{finding.status || '—'}</span>
        </div>
      </div>

      {/* ---------- Two-column grid ---------- */}
      <div className="v2-fd-grid">
        {/* ===== LEFT — Detail ===== */}
        <div className="v2-fd-col">
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Detail</h3>
            </div>
            <div className="v2-fd-body">
              <div className={`v2-fd-desc${finding.desc ? '' : ' empty'}`}>
                {finding.desc || 'No description recorded for this finding.'}
              </div>
              <dl className="v2-fd-kv">
                {metaParts.map((m) => (
                  <div key={m.k} style={{ display: 'contents' }}>
                    <dt>{m.k}</dt>
                    <dd>{m.v}</dd>
                  </div>
                ))}
                <div style={{ display: 'contents' }}>
                  <dt>Last seen</dt>
                  <dd>{finding.age || '—'}</dd>
                </div>
              </dl>
            </div>
            <div className="v2-fd-status">
              <div>
                <div className="k">Status</div>
                <div className="v">{finding.status || '—'}</div>
              </div>
              <Link href="/v2/security" className="v2-btn ghost">
                Back to Security
              </Link>
            </div>
          </div>
        </div>

        {/* ===== RIGHT ===== */}
        <div className="v2-fd-col">
          {/* Hermes · Security assessment */}
          <HermesPanel refId={ref} agent="security" />

          {/* Linked records */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Linked records</h3>
            </div>
            {edges.length === 0 ? (
              <div className="v2-fd-empty">No linked records.</div>
            ) : (
              <div className="v2-fd-link-list">
                {edges.map((e, i) => (
                  <Link key={`${e.type}-${e.id}-${i}`} href={e.href} className="v2-fd-link">
                    <div className="v2-fd-link-main">
                      <div className="v2-fd-link-id">{e.label || e.id}</div>
                      <div className="v2-fd-link-sub">{e.rel}</div>
                    </div>
                    <span className="v2-fd-link-kind">{EDGE_KIND[e.type] ?? e.type}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
