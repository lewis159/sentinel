import Link from 'next/link';
import { marked } from 'marked';
import { requireSectionPage } from '@/lib/auth';
import '../kb.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Hermes-authored draft review. The support copilot clusters recurring tickets,
// drafts a KB article, and parks it here for a human to approve, edit or reject.
// Everything is static/plausible — the "How Hermes wrote this" panel names the
// real source tickets it learned from and a confidence score.
// ---------------------------------------------------------------------------

const DRAFT_TITLE = 'API rate limits explained';
const DRAFT_CATEGORY = 'Technical';
const CONFIDENCE = 94;

const DRAFT_BODY = `Customers on the public API occasionally see \`429 Too Many Requests\` and want to know why and what to do. This article explains the limits, the headers we return, and how to work within them.

## What the limits are

Rate limits are applied **per tenant**, not per IP, and reset on a rolling 60-second window:

| Endpoint            | Limit           | Window |
| ------------------- | --------------- | ------ |
| \`POST /api/videos\`  | 30 requests     | 60s    |
| \`GET /api/videos\`   | 120 requests    | 60s    |
| \`GET /api/status\`   | 300 requests    | 60s    |

## Reading the response

Every response includes your current budget so you can pace requests without guessing:

\`\`\`
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 12
Retry-After: 42          # only on a 429
\`\`\`

When you receive a \`429\`, wait \`Retry-After\` seconds before retrying. A well-behaved client should back off exponentially rather than hammering the endpoint.

## Bulk imports

If you are doing a legitimate bulk import and consistently hit the submit limit, contact support — we can raise your window rather than have you throttle by hand. Bulk import is a supported workflow, not abuse.

> Rate-limited requests never consume credits. A \`429\` means the request was rejected before any work was done, so your balance is untouched.`;

interface Source {
  id: string;
  label: string;
}

const SOURCES: Source[] = [
  { id: 'OPS-0006', label: 'Public submit endpoint hammered — customer over quota' },
  { id: 'SUP-0341', label: 'Getting 429s on /api/videos, is this a bug?' },
  { id: 'SUP-0318', label: 'What do the X-RateLimit headers mean?' },
  { id: 'SUP-0290', label: 'Bulk import keeps hitting a limit' },
];

interface Check {
  state: 'pass' | 'warn';
  label: string;
  detail: string;
}

const CHECKS: Check[] = [
  { state: 'pass', label: 'No customer PII in body', detail: 'Scanned draft — no names, emails or keys.' },
  { state: 'pass', label: 'No secrets or credentials', detail: 'No tokens, connection strings or env values.' },
  { state: 'pass', label: 'Claims match source tickets', detail: 'Limits and headers verified against config.' },
  { state: 'warn', label: 'One figure needs a human check', detail: 'GET limit of 300/60s — confirm current value.' },
];

function SparkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default async function V2KbDraftsPage() {
  await requireSectionPage('overview');

  const html = marked.parse(DRAFT_BODY) as string;

  return (
    <div className="v2-kb-page">
      <Link href="/v2/kb" className="v2-kb-back">
        ← Knowledge base
      </Link>

      {/* Header */}
      <div className="v2-kb-head-row">
        <div>
          <div className="v2-eyebrow">Knowledge base · Draft review</div>
          <h1 className="v2-h1">{DRAFT_TITLE}</h1>
          <div className="v2-kb-article-meta">
            <span className={`v2-kb-cat ${DRAFT_CATEGORY.toLowerCase()}`}>{DRAFT_CATEGORY}</span>
            <span className="sep">·</span>
            <span className="v2-kb-draft-tag">
              <SparkIcon size={11} />
              Hermes draft
            </span>
            <span className="sep">·</span>
            <span>Drafted 6 hours ago · not yet published</span>
          </div>
        </div>
      </div>

      <div className="v2-kb-draft-grid">
        {/* ===== Preview ===== */}
        <div>
          <div className="v2-card" style={{ padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="v2-kb-draft-tag">
              <SparkIcon size={11} />
              Preview
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>This is how the article will read once approved.</span>
          </div>

          <div className="v2-kb-prose" dangerouslySetInnerHTML={{ __html: html }} />

          {/* Actions */}
          <div className="v2-kb-draft-actions">
            <button className="v2-btn v2-kb-btn-publish">Approve &amp; publish</button>
            <button className="v2-btn ghost">Edit draft</button>
            <button className="v2-btn ghost">Reject</button>
          </div>
        </div>

        {/* ===== Right rail ===== */}
        <aside className="v2-kb-rail">
          {/* How Hermes wrote this */}
          <div className="v2-card v2-kb-hermes">
            <div className="v2-card-h">
              <h3>How Hermes wrote this</h3>
              <span className="v2-kb-hermes-badge">
                <SparkIcon size={10} /> Hermes
              </span>
            </div>
            <div className="v2-kb-hermes-body">
              <p className="v2-kb-hermes-lead">
                Hermes clustered <b style={{ color: 'var(--text-strong)' }}>4 recurring tickets</b> about rate limiting
                and drafted a single canonical answer, cross-checking each limit against the live gateway config.
              </p>

              <div>
                <div className="v2-kb-article-meta" style={{ marginTop: 0, marginBottom: 8 }}>
                  <span className="v2-eyebrow">Learned from</span>
                </div>
                <div className="v2-kb-src-list">
                  {SOURCES.map((s) => (
                    <div key={s.id} className="v2-kb-src">
                      <span className="v2-kb-src-id">{s.id}</span>
                      <span className="v2-kb-src-lab">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="v2-kb-conf">
                <div className="v2-kb-conf-top">
                  <span>Confidence</span>
                  <b>{CONFIDENCE}%</b>
                </div>
                <div className="v2-kb-conf-track">
                  <div className="v2-kb-conf-fill" style={{ width: `${CONFIDENCE}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Safety checks */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Safety checks</h3>
              <span className="v2-pill ok">3 / 4 passed</span>
            </div>
            <div style={{ padding: '6px 16px 14px' }}>
              <div className="v2-kb-checks">
                {CHECKS.map((c) => (
                  <div key={c.label} className="v2-kb-check">
                    <span className={`v2-kb-check-ic ${c.state}`}>{c.state === 'pass' ? <CheckIcon /> : <WarnIcon />}</span>
                    <div className="v2-kb-check-main">
                      <b>{c.label}</b>
                      <span>{c.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
