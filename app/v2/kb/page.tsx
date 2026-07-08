import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import './kb.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Static, human-plausible KB index. Each card links to /v2/kb/{slug} where the
// full article body lives. The category set mirrors the filter chips below;
// "Hermes-authored" flags articles the support copilot drafted from real
// tickets and a human later approved. No lorem — every excerpt is real guidance.
// ---------------------------------------------------------------------------

type Category = 'Technical' | 'Billing' | 'Onboarding' | 'Security';

interface ArticleCard {
  slug: string;
  title: string;
  category: Category;
  excerpt: string;
  updated: string;
  hermes?: boolean;
}

const CATEGORIES: ('All' | Category)[] = ['All', 'Technical', 'Billing', 'Onboarding', 'Security'];

const ARTICLES: ArticleCard[] = [
  {
    slug: 'recover-stalled-worker',
    title: 'Recovering a stalled transcription worker',
    category: 'Technical',
    excerpt:
      'When a job sits in "processing" past its lease, the worker has usually lost its Redis heartbeat. Requeue safely without double-charging credits.',
    updated: 'updated 3d ago',
  },
  {
    slug: 'docker-socket-proxy',
    title: 'Hardening the Docker socket with a read-only proxy',
    category: 'Security',
    excerpt:
      'Containers that mount the raw Docker socket get root on the host. Front the daemon with a scoped socket-proxy and drop the direct bind mount.',
    updated: 'updated 3d ago',
    hermes: true,
  },
  {
    slug: 'failed-payment-dunning',
    title: 'How failed payments and dunning retries work',
    category: 'Billing',
    excerpt:
      'Stripe retries a declined charge four times over 14 days before the subscription lapses. Here is the retry cadence and how to reset it manually.',
    updated: 'updated 5d ago',
  },
  {
    slug: 'reset-customer-2fa',
    title: "Resetting a customer's two-factor authentication",
    category: 'Onboarding',
    excerpt:
      'Locked-out customers need identity confirmation before you clear their TOTP secret in Clerk. Follow the verification steps before removing the factor.',
    updated: 'updated 1w ago',
  },
  {
    slug: 'rate-limiting',
    title: 'Adding rate limits to public submit endpoints',
    category: 'Technical',
    excerpt:
      'A shared per-tenant counter on /api/videos absorbs abuse traffic before it eats a customer quota. Set sane windows and return a clean 429.',
    updated: 'updated 2d ago',
    hermes: true,
  },
  {
    slug: 'plan-proration',
    title: 'Plan upgrades, downgrades and proration',
    category: 'Billing',
    excerpt:
      'Upgrades bill the difference immediately; downgrades take effect next cycle. Explains how credits carry over and when a proration invoice is raised.',
    updated: 'updated 6d ago',
  },
];

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export default async function V2KbPage() {
  await requireSectionPage('overview');

  return (
    <div className="v2-kb-page">
      {/* Header */}
      <div className="v2-kb-head-row">
        <div>
          <div className="v2-eyebrow">Knowledge base</div>
          <h1 className="v2-h1">Knowledge base</h1>
          <div className="v2-sub">Runbooks, remediation guides and Hermes-authored articles across the estate.</div>
        </div>
      </div>

      {/* Search (static) */}
      <div className="v2-kb-search">
        <SearchIcon />
        <input type="text" placeholder="Search runbooks, guides and articles…" readOnly />
        <kbd style={{ fontSize: 10, color: 'var(--faint)' }}>/</kbd>
      </div>

      {/* Category chips (static) */}
      <div className="v2-kb-chips">
        {CATEGORIES.map((c) => (
          <button key={c} className={`v2-kb-chip${c === 'All' ? ' on' : ''}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Hermes drafts banner */}
      <Link href="/v2/kb/drafts" className="v2-kb-banner">
        <span className="v2-kb-banner-ic">
          <SparkIcon />
        </span>
        <span className="v2-kb-banner-txt">
          <b>2 Hermes drafts awaiting review</b>
          <span>The support copilot turned recurring tickets into draft articles. Review before they publish.</span>
        </span>
        <span className="v2-kb-banner-cta">Review drafts →</span>
      </Link>

      {/* Article grid */}
      <div className="v2-kb-grid">
        {ARTICLES.map((a) => (
          <Link key={a.slug} href={`/v2/kb/${a.slug}`} className="v2-kb-card">
            <div className="v2-kb-card-top">
              <span className={`v2-kb-cat ${a.category.toLowerCase()}`}>{a.category}</span>
              {a.hermes && (
                <span className="v2-kb-authored">
                  <SparkIcon size={11} />
                  Hermes-authored
                </span>
              )}
            </div>
            <div className="v2-kb-card-title">{a.title}</div>
            <div className="v2-kb-card-excerpt">{a.excerpt}</div>
            <div className="v2-kb-card-foot">{a.updated}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
