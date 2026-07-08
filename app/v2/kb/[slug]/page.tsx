import Link from 'next/link';
import { marked } from 'marked';
import { requireSectionPage } from '@/lib/auth';
import '../kb.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Static article store. Each entry carries header metadata + a markdown body
// rendered through `marked` into the .v2-kb-prose column. Content is real,
// plausible runbook guidance for the Sentinel/Scribuo estate — no lorem.
// ---------------------------------------------------------------------------

type Category = 'Technical' | 'Billing' | 'Onboarding' | 'Security';

interface Related {
  slug: string;
  title: string;
  category: Category;
}

interface Article {
  title: string;
  category: Category;
  updated: string;
  author: string;
  hermes?: boolean;
  related: Related[];
  body: string;
}

const ARTICLES: Record<string, Article> = {
  'recover-stalled-worker': {
    title: 'Recovering a stalled transcription worker',
    category: 'Technical',
    updated: 'Updated 3 days ago',
    author: 'Ben Percival',
    related: [
      { slug: 'rate-limiting', title: 'Adding rate limits to public submit endpoints', category: 'Technical' },
      { slug: 'failed-payment-dunning', title: 'How failed payments and dunning retries work', category: 'Billing' },
    ],
    body: `A transcription job that sits in the **processing** state past its lease has almost always lost its worker heartbeat — the worker crashed, was OOM-killed, or lost its Redis connection mid-job. This runbook requeues the job safely without double-charging the customer's credits.

## Symptoms

- A job shows \`status = processing\` with a \`leased_at\` older than the 15-minute lease window.
- The owning worker container is gone or has restarted since \`leased_at\`.
- The customer sees a job "stuck" and may have already opened a ticket.

## Confirm the lease is dead

Check that no live worker still holds the lease before you touch it:

\`\`\`bash
# The heartbeat key expires 90s after the last tick.
redis-cli EXISTS worker:heartbeat:<worker_id>
\`\`\`

If the key is gone, the lease is orphaned and safe to reclaim.

## Requeue without double-charging

Credits are debited at **job completion**, not at submission, so requeuing a never-completed job cannot double-charge. Reset the job back to \`queued\` and clear the stale lease:

1. Set \`status = queued\`, null out \`leased_at\` and \`worker_id\`.
2. Increment \`retry_count\` so the poison-pill guard can trip after 3 attempts.
3. Leave the credit ledger untouched — no debit has been written yet.

> If \`retry_count\` has already reached 3, do **not** requeue automatically. The job is likely a poison pill (corrupt media, unsupported codec). Move it to \`failed\` and refund any hold.

## Verify

The next poll cycle (≤10s) should pick the job up on a healthy worker. Watch the job move \`queued → processing → complete\` and confirm a single credit debit lands in the ledger.`,
  },
  'docker-socket-proxy': {
    title: 'Hardening the Docker socket with a read-only proxy',
    category: 'Security',
    updated: 'Updated 3 days ago',
    author: 'Hermes · Support',
    hermes: true,
    related: [
      { slug: 'rate-limiting', title: 'Adding rate limits to public submit endpoints', category: 'Technical' },
      { slug: 'recover-stalled-worker', title: 'Recovering a stalled transcription worker', category: 'Technical' },
    ],
    body: `Any container that bind-mounts the raw Docker socket (\`/var/run/docker.sock\`) effectively has **root on the host** — it can start privileged containers, read every other stack's secrets, and rewrite the daemon config. This article replaces the direct mount with a scoped, read-only socket proxy.

## Why the raw socket is dangerous

The Docker daemon API has no per-endpoint authorization. Mounting the socket read-write hands the container the full API surface: \`POST /containers/create\` with \`Privileged: true\` is a host takeover in one call.

## The fix: a scoped socket proxy

Front the daemon with [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy). It exposes the API over TCP on an internal network and gates each endpoint group with an environment flag — default deny.

\`\`\`yaml
socket-proxy:
  image: tecnativa/docker-socket-proxy
  environment:
    CONTAINERS: 1   # allow read of container list
    SERVICES: 1     # allow read of swarm services
    POST: 0         # deny all writes
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  networks: [socket-net]
\`\`\`

## Migration steps

1. Deploy the proxy on an internal-only network.
2. Point the consuming service at \`tcp://socket-proxy:2375\` via \`DOCKER_HOST\`.
3. **Remove** the direct \`docker.sock\` bind mount from the app container.
4. Confirm the app still reads what it needs and that writes now return \`403\`.

> Set \`POST: 0\` unless a service genuinely needs to create containers. Portainer and monitoring agents almost never do — they only read.

## Verify

From inside the app container, a read should succeed and a write should be refused:

\`\`\`bash
curl tcp://socket-proxy:2375/containers/json      # 200
curl -XPOST tcp://socket-proxy:2375/containers/create  # 403 Forbidden
\`\`\``,
  },
  'failed-payment-dunning': {
    title: 'How failed payments and dunning retries work',
    category: 'Billing',
    updated: 'Updated 5 days ago',
    author: 'Ben Percival',
    related: [
      { slug: 'plan-proration', title: 'Plan upgrades, downgrades and proration', category: 'Billing' },
      { slug: 'reset-customer-2fa', title: "Resetting a customer's two-factor authentication", category: 'Onboarding' },
    ],
    body: `When a subscription renewal is declined, Stripe enters **dunning** — a fixed schedule of retries and customer emails before the subscription lapses. This article explains the cadence and how to intervene.

## Retry schedule

Our Stripe Billing settings use Smart Retries over a 14-day window:

| Attempt | Timing            | Customer email        |
| ------- | ----------------- | --------------------- |
| 1       | On renewal date   | "Payment failed"      |
| 2       | +3 days           | Reminder              |
| 3       | +5 days           | Reminder              |
| 4       | +14 days (final)  | "Final notice"        |

After the final failed attempt the subscription moves to \`canceled\` and the account drops to the **Free** tier at the next access check.

## What the customer sees

- Access continues during the retry window — we do **not** hard-lock on the first decline.
- The in-app banner shows "Update your payment method" once attempt 1 fails.

## Manual intervention

If the customer has fixed their card and wants immediate reactivation:

1. Confirm the new payment method is attached in Stripe.
2. Trigger a manual retry on the open invoice (\`Pay invoice\`).
3. On success, the subscription returns to \`active\` and the tier restores on the next entitlement pull.

> Never comp a paid tier by hand-editing entitlements. Fix the invoice in Stripe so billing and access stay in sync — the estate pulls entitlements from Stripe, not the other way around.`,
  },
  'reset-customer-2fa': {
    title: "Resetting a customer's two-factor authentication",
    category: 'Onboarding',
    updated: 'Updated 1 week ago',
    author: 'Ben Percival',
    related: [
      { slug: 'failed-payment-dunning', title: 'How failed payments and dunning retries work', category: 'Billing' },
      { slug: 'docker-socket-proxy', title: 'Hardening the Docker socket with a read-only proxy', category: 'Security' },
    ],
    body: `A customer who has lost their authenticator device cannot receive a TOTP code and is locked out. Clearing their second factor is a sensitive action — **identity must be confirmed first**, because removing 2FA weakens the account until they re-enrol.

## Before you touch anything

Verify the requester actually owns the account. Do **not** proceed on an email request alone:

- Confirm the request comes from the email on file, and
- Confirm at least one of: last four digits of the card on file, the org name, or a recent invoice number.

> If you cannot confirm identity, stop. Route to the account owner rather than resetting the factor. A social-engineered 2FA reset is an account takeover.

## Clear the factor in Clerk

Once identity is confirmed:

1. Open the user in the Clerk dashboard for the correct instance (**prod = clerk.scribuo.com**).
2. Under **Security**, remove the registered TOTP factor.
3. Leave the account otherwise intact — do not reset the password unless asked.

## Force re-enrolment

2FA should not stay off. On next sign-in the customer is prompted to enrol a new authenticator. Confirm with them that they have re-added a factor before you close the ticket.

## Log it

Note the reset and the identity checks you performed in the ticket. This is the audit trail if the account is later disputed.`,
  },
  'rate-limiting': {
    title: 'Adding rate limits to public submit endpoints',
    category: 'Technical',
    updated: 'Updated 2 days ago',
    author: 'Hermes · Support',
    hermes: true,
    related: [
      { slug: 'recover-stalled-worker', title: 'Recovering a stalled transcription worker', category: 'Technical' },
      { slug: 'docker-socket-proxy', title: 'Hardening the Docker socket with a read-only proxy', category: 'Security' },
    ],
    body: `Public submit endpoints like \`/api/videos\` are the estate's most-abused surface: a burst of automated submissions can drain a tenant's credit quota before the tenant has done anything. A per-tenant token bucket absorbs the abuse and returns a clean \`429\`.

## The shape of the limit

Use a sliding-window counter keyed by tenant, not by IP — abuse rotates IPs but shares one API key:

\`\`\`
key:   ratelimit:videos:<tenant_id>
window: 60s
limit:  30 requests
\`\`\`

Thirty submits a minute is generous for a real user and hostile to a scraper.

## Return a clean 429

When the bucket is empty, respond with a structured error and a \`Retry-After\` header so well-behaved clients back off:

\`\`\`json
HTTP/1.1 429 Too Many Requests
Retry-After: 42
{ "error": "rate_limited", "retry_after_s": 42 }
\`\`\`

## Do not let it eat quota

The most important rule: a \`429\` must be rejected **before** the credit debit path. A rate-limited request has cost the customer nothing, so no ledger entry is written. Verify this end-to-end — an abuse burst should leave the customer's balance untouched.

> If a legitimate customer trips the limit during a genuine bulk import, raise their window rather than resetting quota. Bulk import is a first-class feature, not abuse.

## Verify

Fire 40 requests in a 60-second window against a test tenant. Expect 30 × \`200\` then 10 × \`429\`, and confirm the credit ledger shows exactly 30 debits — not 40.`,
  },
  'plan-proration': {
    title: 'Plan upgrades, downgrades and proration',
    category: 'Billing',
    updated: 'Updated 6 days ago',
    author: 'Ben Percival',
    related: [
      { slug: 'failed-payment-dunning', title: 'How failed payments and dunning retries work', category: 'Billing' },
      { slug: 'reset-customer-2fa', title: "Resetting a customer's two-factor authentication", category: 'Onboarding' },
    ],
    body: `Mid-cycle plan changes are prorated by Stripe. Upgrades bill the difference immediately; downgrades take effect at the next renewal. This article explains what the customer is charged and when.

## Upgrades (bill now)

Moving from, say, **Starter (£9)** to **Pro (£18)** part-way through a cycle:

- Stripe raises an immediate proration invoice for the unused portion of the new plan minus the unused portion of the old one.
- The new tier's entitlements apply on the next access check — usually within seconds.

## Downgrades (bill next cycle)

Moving down a tier does **not** refund the current cycle:

- The customer keeps the higher tier until the period ends.
- The lower plan and its price take effect at renewal.
- Any unused metered add-ons (extra clips, dubbing minutes) are forfeited at the boundary unless carried as credits.

## Credits carry-over

Top-up credits are decoupled from the subscription and **do not** reset on a plan change. A customer who bought 500 credits keeps them across an upgrade or downgrade.

> Metered plan allowances (the monthly included minutes) do reset each cycle. Purchased credits do not. Be precise about which the customer is asking about.

## When a proration invoice looks wrong

If a customer disputes a proration charge, open the invoice in Stripe and read the line items — each shows the plan, the date range, and the prorated amount. The maths is almost always right; the customer usually expected a refund on a downgrade that our policy does not give.`,
  },
};

function SparkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function initials(name: string): string {
  const clean = name.replace(/·.*/, '').trim();
  const parts = clean.split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  await requireSectionPage('overview');
  const { slug } = await params;

  const article = ARTICLES[slug];

  if (!article) {
    return (
      <div>
        <div className="v2-eyebrow">Knowledge base · Article</div>
        <h1 className="v2-h1">Article not found</h1>
        <div className="v2-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="v2-sub" style={{ marginTop: 0 }}>
            Article <b>{slug}</b> does not exist. It may have been unpublished or the link is mistyped.
          </div>
          <div style={{ marginTop: 14 }}>
            <Link href="/v2/kb" className="v2-link">
              ← Back to the knowledge base
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const html = marked.parse(article.body) as string;

  return (
    <div className="v2-kb-page">
      <Link href="/v2/kb" className="v2-kb-back">
        ← Knowledge base
      </Link>

      <div className="v2-kb-article-grid">
        {/* ===== Main ===== */}
        <div>
          <div className="v2-kb-article-head">
            <div className="v2-eyebrow">Knowledge base · {article.category}</div>
            <h1 className="v2-h1">{article.title}</h1>
            <div className="v2-kb-article-meta">
              <span className={`v2-kb-cat ${article.category.toLowerCase()}`}>{article.category}</span>
              <span className="sep">·</span>
              <span className="v2-kb-article-author">
                <span className="av">{initials(article.author)}</span>
                {article.author}
              </span>
              <span className="sep">·</span>
              <span>{article.updated}</span>
              {article.hermes && (
                <span className="v2-kb-authored">
                  <SparkIcon size={11} />
                  Hermes-authored
                </span>
              )}
            </div>
          </div>

          <div className="v2-kb-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>

        {/* ===== Right rail ===== */}
        <aside className="v2-kb-rail">
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Related</h3>
            </div>
            <div className="v2-kb-rail-body">
              {article.related.map((r) => (
                <Link key={r.slug} href={`/v2/kb/${r.slug}`} className="v2-kb-related">
                  <span className={`v2-kb-cat ${r.category.toLowerCase()}`}>{r.category}</span>
                  <span>{r.title}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Was this helpful?</h3>
            </div>
            <div className="v2-kb-help">
              <p>Feedback tunes what Hermes drafts next and flags stale runbooks for review.</p>
              <div className="v2-kb-help-btns">
                <button className="v2-kb-help-btn">👍 Yes</button>
                <button className="v2-kb-help-btn">👎 No</button>
              </div>
              <div className="v2-kb-help-meta">92% of 48 readers found this helpful</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
