// Hermes · Support — knowledge-base retrieval for grounded drafts.
//
// retrieveKb() is the single entry point every department agent calls. It has
// two backends with the SAME return shape:
//
//   1. pgvector semantic retrieval (lib/hermes/kb-vector.ts) — real embeddings
//      over content/kb/*.md + resolved tickets, indexed into hermes.kb_chunks.
//      Active ONLY when HERMES_KB_PGVECTOR is on (kbPgvectorEnabled()).
//   2. dependency-free LEXICAL retrieval (retrieveKbLexical, below) — the
//      original curated-snippet keyword-overlap ranker. This is the DEFAULT and
//      the FAIL-SAFE fallback: used whenever the sub-flag is off, or when the
//      vector path is unavailable (no DB, no embeddings key, migration not
//      applied, empty store). So the app is unchanged unless the flag is set.
//
// The lexical path holds no secrets and reads no filesystem, so it stays
// unit-testable in isolation; the vector module is dynamically imported only
// when the flag is on, keeping this module dependency-light for the default path.
//
// Slugs match the live v2 KB articles (app/v2/kb/[slug]/page.tsx) so a cited
// article resolves to a real page at /v2/kb/<slug>.

import { kbPgvectorEnabled } from './brain/flags';

export type KbSnippet = { slug: string; title: string; body: string };

// Curated, concise (2-4 sentence) summaries seeded from the v2 KB article set
// plus the common support topics referenced across the app. Bodies are real
// runbook guidance — no lorem.
export const KB_ARTICLES: KbSnippet[] = [
  {
    slug: 'rate-limiting',
    title: 'Adding rate limits to public submit endpoints',
    body: 'Public submit endpoints return a 429 Too Many Requests when a per-tenant token bucket is empty (30 requests / 60s), with a Retry-After header so clients back off. A 429 is rejected before the credit-debit path, so a rate-limited request costs the customer nothing. If a legitimate customer trips the limit during a genuine bulk import, raise their window rather than resetting quota.',
  },
  {
    slug: 'failed-payment-dunning',
    title: 'How failed payments and dunning retries work',
    body: 'A declined renewal enters Stripe dunning: Smart Retries over a 14-day window (attempts on day 0, +3, +5, +14) with customer emails, then the subscription cancels and drops to Free. Access continues during the retry window; we do not hard-lock on the first decline. To reactivate after a fixed card, retry the open invoice in Stripe rather than hand-editing entitlements.',
  },
  {
    slug: 'plan-proration',
    title: 'Plan upgrades, downgrades and proration',
    body: 'Upgrades bill the prorated difference immediately and apply the new tier within seconds; downgrades take effect at the next renewal with no refund for the current cycle. Purchased top-up credits are decoupled from the subscription and do NOT reset on a plan change, but metered monthly allowances do reset each cycle. Disputed proration charges are almost always correct — read the invoice line items in Stripe.',
  },
  {
    slug: 'reset-customer-2fa',
    title: "Resetting a customer's two-factor authentication",
    body: 'Clearing a lost second factor is sensitive: confirm the requester owns the account (email on file plus one of card last-four, org name, or a recent invoice number) before touching anything. Remove the TOTP factor in the Clerk dashboard for the correct instance (prod = clerk.scribuo.com), then force re-enrolment on next sign-in. If identity cannot be confirmed, stop and route to the account owner — a social-engineered 2FA reset is account takeover.',
  },
  {
    slug: 'recover-stalled-worker',
    title: 'Recovering a stalled transcription worker',
    body: 'A job stuck in processing past its 15-minute lease has usually lost its worker heartbeat (crash, OOM, or Redis disconnect). Confirm the heartbeat key is gone, then requeue by resetting status to queued and clearing leased_at/worker_id; credits are debited at completion so requeuing never double-charges. If retry_count has already reached 3 do not auto-requeue — treat it as a poison pill, mark it failed, and refund any hold.',
  },
  {
    slug: 'docker-socket-proxy',
    title: 'Hardening the Docker socket with a read-only proxy',
    body: 'A container that bind-mounts the raw Docker socket read-write effectively has root on the host. Front the daemon with a scoped read-only socket proxy (tecnativa/docker-socket-proxy) that gates each endpoint group and denies all writes (POST: 0), then remove the direct socket mount from the app container. Verify that reads still succeed and writes now return 403.',
  },
  {
    slug: 'teammate-invites',
    title: 'Inviting teammates and managing seats',
    body: 'Team plans invite teammates from Settings → Members by email; the invitee accepts via a Clerk invitation link and lands in the correct organization. A seat is consumed only when an invite is accepted, not when it is sent, and pending invites can be revoked to free a pending seat. If an invite email never arrives, check the spam folder and confirm the address matches the one on the invite before resending.',
  },
  {
    slug: 'sso-setup',
    title: 'Setting up SSO / SAML for an organization',
    body: 'Enterprise organizations can enable SAML SSO so members sign in through their own identity provider (Okta, Entra ID, Google Workspace). Configure the connection in Clerk with the IdP metadata, then verify the domain so matching email addresses are routed to SSO automatically. SSO enforcement is per-organization — confirm which org the customer means before enabling, as it changes how every member of that org authenticates.',
  },
  {
    slug: 'oauth-redirect-uri',
    title: 'Fixing OAuth redirect_uri mismatch on Google sign-in',
    body: 'A redirect_uri_mismatch on Google login means the redirect URI in the Google Cloud OAuth client does not exactly match what Clerk sends. For prod the authorized redirect URI must be https://clerk.scribuo.com/v1/oauth_callback, added to the same OAuth client whose client ID/secret are configured in Clerk. An invalid_client error instead points to a wrong client ID or secret rather than the redirect URI.',
  },
  {
    slug: 'disk-cleanup',
    title: 'Reclaiming disk space on a full host',
    body: 'A host at high disk usage is most often full of dangling Docker images, stopped containers, and build cache; docker system prune reclaims these safely, and unused volumes can be pruned separately once you confirm none hold live data. Old transcription artifacts in object storage are lifecycle-expired, not stored on the host, so they are not the cause. Never prune volumes without confirming they are not attached to a running stack.',
  },
];

// English stopwords + low-signal support terms that would otherwise inflate
// overlap scores on almost every ticket.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'up', 'as',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he',
  'she', 'my', 'our', 'your', 'their', 'me', 'us', 'them', 'not', 'no', 'so',
  'if', 'then', 'than', 'can', 'cannot', 'cant', 'will', 'wont', 'would', 'could',
  'should', 'do', 'does', 'did', 'have', 'has', 'had', 'get', 'got', 'about',
  'how', 'what', 'when', 'where', 'why', 'who', 'which', 'please', 'help', 'hi',
  'hello', 'thanks', 'thank', 'im', 'ive', 'am', 'any', 'all', 'some', 'just',
  'now', 'out', 'off', 'there', 'here', 'been', 'into', 'over', 'more',
]);

function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Retrieve KB snippets relevant to a ticket query.
 *
 * When HERMES_KB_PGVECTOR is enabled, tries real pgvector semantic retrieval
 * first; on any miss (feature off, no DB/key, migration not applied, empty
 * store, or the query embeds but the vector search errors) it FALLS BACK to the
 * lexical snippet retriever below. Return shape is identical either way, so all
 * agent callers are unaffected. Never throws.
 */
export async function retrieveKb(query: string, limit = 3): Promise<KbSnippet[]> {
  if (kbPgvectorEnabled()) {
    try {
      // Dynamic import keeps the DB/embeddings deps out of the default (lexical)
      // path and out of the unit-test surface.
      const { retrieveKbVector } = await import('./kb-vector');
      const hit = await retrieveKbVector(query, limit);
      if (hit && hit.length > 0) return hit;
      // null (unavailable) or [] (empty store) → fall through to lexical.
    } catch {
      // Any unexpected failure → lexical fallback below.
    }
  }
  return retrieveKbLexical(query, limit);
}

/**
 * Retrieve the KB snippets most relevant to a ticket query using dependency-free
 * lexical overlap. Score = (shared significant words in TITLE × 3) + (shared
 * significant words in BODY × 1); title matches are weighted higher because a
 * title term is a stronger topic signal. Returns the top `limit` snippets with a
 * score > 0, or [] when nothing overlaps (the caller then drafts without a KB
 * block rather than citing something irrelevant).
 */
export async function retrieveKbLexical(query: string, limit = 3): Promise<KbSnippet[]> {
  const q = significantWords(query);
  if (q.size === 0) return [];

  const scored = KB_ARTICLES.map((article) => {
    const titleWords = significantWords(article.title);
    const bodyWords = significantWords(article.body);
    let score = 0;
    for (const w of q) {
      if (titleWords.has(w)) score += 3;
      else if (bodyWords.has(w)) score += 1;
    }
    return { article, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((s) => s.article);
}
