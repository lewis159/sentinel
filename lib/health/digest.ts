// Customer-Health Digest — portfolio assembly (Sentinel · Hermes console).
//
// Reads the estate's customers from the `ops` mirror tables, derives per-customer
// health SIGNALS, scores each via the pure scorer (lib/health/score.ts), and rolls
// the results up into a portfolio digest: band counts, the at-risk list, upsell
// candidates, and coarse top-movers. READ-ONLY — nothing here writes or acts.
//
// Data sources (all read-through, additive; no schema change):
//   * ops.orgs / ops.org_members       → the customer set + team size
//   * ops.app_entitlements             → usage/quota + adopted apps + tier
//   * ops.tickets                      → open / recent / critical ticket load
//   * lib/inngest/signals/churn.ts     → portfolio failed-payment (churn) context
//
// Mock-safe: with no DB (hasDb === false) OR on any query error, it degrades to a
// curated deterministic MOCK portfolio so the page always renders in dev.
//
// Optional LLM narrative: a one-paragraph advisory summary of the week, gated by
// HERMES_BRAIN_ENABLED (brainEnabled()). ADVISORY TEXT ONLY — it never proposes or
// takes an action. When the flag is off the model is NEVER imported or called.
import 'server-only';
import { hasDb, q } from '@/lib/db';
import { withTenantRls, OPERATOR_IDENTITY } from '@/lib/data';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { churnSignal, type ChurnSignal } from '@/lib/inngest/signals/churn';
import {
  scoreCustomer,
  type HealthBand,
  type HealthScore,
  type HealthSignals,
} from './score';

// A customer + its derived signals, before scoring.
export type CustomerHealthInput = {
  id: string; // tenant key (Clerk org id) — links to Customer 360 / churn-save
  name: string;
  email: string | null;
  tier: string | null; // representative entitlement tier (for upsell detection)
  signals: HealthSignals;
};

export type UpsellFlag = {
  candidate: true;
  reason: string;
};

// A scored customer row for the digest table.
export type CustomerHealth = CustomerHealthInput & {
  health: HealthScore;
  upsell: UpsellFlag | null;
};

export type HealthDigest = {
  generatedAt: string;
  live: boolean;
  note?: string;
  totals: { customers: number };
  bandCounts: Record<HealthBand, number>;
  customers: CustomerHealth[]; // sorted worst-first (lowest score) by default
  atRisk: CustomerHealth[]; // band === at-risk | critical
  upsellCandidates: CustomerHealth[];
  topMovers: { improving: CustomerHealth[]; declining: CustomerHealth[] };
  churn: ChurnSignal; // portfolio failed-payment context (not per-customer)
  narrative: string | null; // LLM advisory text; null when brain off/unavailable
  narrativeSource: 'model' | 'disabled' | 'unavailable';
};

// Recency window for "recent tickets" and the churn proxy display.
const RECENT_DAYS = 30;

// Terminal ticket states — an open ticket is anything NOT in this set (mirrors
// lib/data.ts / getTicketsNeedingHuman semantics).
const TERMINAL = new Set([
  'resolved', 'closed', 'fulfilled', 'cancelled', 'canceled',
  'implemented', 'done', 'completed', 'deployed', 'verified',
]);

// Tiers we treat as "low" for upsell (thriving/healthy on one of these = candidate).
const LOW_TIERS = new Set(['free', 'starter', 'trial', 'basic']);

// ---------------------------------------------------------------------------
// Upsell detection. A customer is an upsell candidate when EITHER:
//   (a) they are near/over quota (>= 80% utilisation) — natural expansion, OR
//   (b) they are thriving/healthy on a LOW tier — headroom to move them up.
// Never flag an at-risk/critical account (fix churn first).
// ---------------------------------------------------------------------------
export function detectUpsell(c: CustomerHealthInput, health: HealthScore): UpsellFlag | null {
  if (health.band === 'at-risk' || health.band === 'critical') return null;
  const ratio = c.signals.quotaUsedRatio;
  if (ratio != null && ratio >= 0.8) {
    return { candidate: true, reason: `At ${Math.round(ratio * 100)}% of quota — expansion likely` };
  }
  const tier = (c.tier ?? '').trim().toLowerCase();
  if ((health.band === 'thriving' || health.band === 'healthy') && (tier === '' || LOW_TIERS.has(tier))) {
    return {
      candidate: true,
      reason: `${health.band === 'thriving' ? 'Thriving' : 'Healthy'} on ${c.tier ?? 'a low'} tier — upgrade headroom`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Curated MOCK portfolio — deterministic, spans all four bands + upsell cases.
// Rooted in the same tenants the mock tickets use (acme/northwind/globex) plus a
// couple of synthetic accounts so the digest demonstrates the full spread in dev.
// ---------------------------------------------------------------------------
const MOCK_INPUTS: CustomerHealthInput[] = [
  {
    id: 'brightpods', name: 'Bright Podcasts', email: 'team@brightpods.fm', tier: 'Starter',
    signals: { quotaUsedRatio: 0.92, entitlementCount: 2, openTickets: 0, recentTickets: 1, criticalTickets: 0, failedPayments: 0, teamSize: 6, lastActivityDays: 1 },
  },
  {
    id: 'delta', name: 'Delta Learning', email: 'ops@delta.edu', tier: 'Business',
    signals: { quotaUsedRatio: 0.61, entitlementCount: 3, openTickets: 1, recentTickets: 1, criticalTickets: 0, failedPayments: 0, teamSize: 12, lastActivityDays: 3 },
  },
  {
    id: 'northwind', name: 'Northwind Labs', email: 'ops@northwind.io', tier: 'Pro',
    signals: { quotaUsedRatio: 0.34, entitlementCount: 2, openTickets: 2, recentTickets: 3, criticalTickets: 1, failedPayments: 0, teamSize: 4, lastActivityDays: 9 },
  },
  {
    id: 'globex', name: 'Globex Media', email: 'it@globex.com', tier: 'Studio',
    signals: { quotaUsedRatio: 0.12, entitlementCount: 1, openTickets: 1, recentTickets: 1, criticalTickets: 0, failedPayments: 1, teamSize: 3, lastActivityDays: 22 },
  },
  {
    id: 'acme', name: 'Acme Co', email: 'ops@acme.co', tier: 'Studio',
    signals: { quotaUsedRatio: 0.05, entitlementCount: 1, openTickets: 3, recentTickets: 5, criticalTickets: 2, failedPayments: 2, teamSize: 2, lastActivityDays: 34 },
  },
];

// ---------------------------------------------------------------------------
// Live assembly. Pulls org/member/entitlement/ticket aggregates and joins them in
// JS by org id (== tenant_ref). Wrapped in operator RLS identity (like
// getCustomer360) because it reads ops.tickets across every tenant. Any failure
// → null so the caller falls back to the mock portfolio.
// ---------------------------------------------------------------------------
async function assembleLiveInputs(now: number): Promise<CustomerHealthInput[] | null> {
  if (!hasDb) return null;
  return withTenantRls(async () => {
    try {
      // 1. Customers + team size.
      const orgs = await q<{ id: string; name: string | null; members: string | number }>(
        `select o.id, o.name,
                (select count(*) from ops.org_members m where m.org_id = o.id) as members
           from ops.orgs o`,
      );
      if (orgs.length === 0) return null;

      // 2. Entitlement aggregates per org (via its members).
      const ents = await q<{
        org_id: string; ent_count: string | number;
        max_ratio: string | number | null; tier: string | null; email: string | null;
      }>(
        `select m.org_id,
                count(distinct e.app) as ent_count,
                max(case when e.quota_limit > 0
                         then e.quota_used::float / e.quota_limit end) as max_ratio,
                (array_agg(e.tier order by e.quota_used desc nulls last)
                   filter (where e.tier is not null))[1] as tier
           from ops.org_members m
           join ops.app_entitlements e on e.clerk_user_id = m.clerk_user_id
          group by m.org_id`,
      );
      const entByOrg = new Map(ents.map((e) => [e.org_id, e]));

      // 3. Ticket aggregates per tenant.
      const terminalList = Array.from(TERMINAL);
      const tix = await q<{
        tenant_ref: string; open_t: string | number; recent_t: string | number;
        crit_t: string | number; last_activity: string | Date | null; email: string | null;
      }>(
        `select tenant_ref,
                count(*) filter (where lower(coalesce(status,'open')) <> all($1)) as open_t,
                count(*) filter (where opened_at >= now() - make_interval(days => $2)) as recent_t,
                count(*) filter (where lower(coalesce(priority,'')) in ('critical','high')
                                   and lower(coalesce(status,'open')) <> all($1)) as crit_t,
                max(opened_at) as last_activity,
                (array_agg(customer_email) filter (where customer_email is not null))[1] as email
           from ops.tickets
          where tenant_ref is not null
          group by tenant_ref`,
        [terminalList, RECENT_DAYS],
      );
      const tixByTenant = new Map(tix.map((t) => [t.tenant_ref, t]));

      return orgs.map((o): CustomerHealthInput => {
        const e = entByOrg.get(o.id);
        const t = tixByTenant.get(o.id);
        const lastActivity = t?.last_activity ? new Date(t.last_activity).getTime() : null;
        const lastActivityDays =
          lastActivity != null ? Math.max(0, Math.floor((now - lastActivity) / 86_400_000)) : null;
        return {
          id: o.id,
          name: o.name ?? o.id,
          email: t?.email ?? null,
          tier: e?.tier ?? null,
          signals: {
            quotaUsedRatio: e?.max_ratio == null ? null : Number(e.max_ratio),
            entitlementCount: Number(e?.ent_count ?? 0) || 0,
            openTickets: Number(t?.open_t ?? 0) || 0,
            recentTickets: Number(t?.recent_t ?? 0) || 0,
            criticalTickets: Number(t?.crit_t ?? 0) || 0,
            // Per-customer failed payments are NOT attributable from the dunning
            // proxy (proposals are keyed by invoice, not tenant). Kept 0 here; the
            // portfolio churn signal is surfaced separately on the digest.
            failedPayments: 0,
            teamSize: Number(o.members ?? 0) || 0,
            lastActivityDays,
          },
        };
      });
    } catch {
      return null;
    }
  }, OPERATOR_IDENTITY);
}

// Optional dependency injection for the model call (keeps the module testable
// WITHOUT importing the server-only model client when the brain is off).
export type ChatFn = (opts: {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ ok: boolean; content?: string; error?: string }>;

async function buildNarrative(
  digest: Omit<HealthDigest, 'narrative' | 'narrativeSource'>,
  chatFn?: ChatFn,
): Promise<{ text: string | null; source: HealthDigest['narrativeSource'] }> {
  // Brain OFF → never import or call the model. This is the guaranteed no-op path.
  if (!brainEnabled()) return { text: null, source: 'disabled' };

  // Lazy-resolve the model client so the server-only OpenRouter module is only
  // pulled in when the brain is actually enabled (and injectable in tests).
  let chat = chatFn;
  if (!chat) {
    const mod = await import('@/lib/hermes/openrouter');
    chat = mod.chat as ChatFn;
  }

  const bc = digest.bandCounts;
  const facts = [
    `Portfolio: ${digest.totals.customers} customers.`,
    `Bands — thriving ${bc.thriving}, healthy ${bc.healthy}, at-risk ${bc['at-risk']}, critical ${bc.critical}.`,
    `At-risk/critical accounts: ${digest.atRisk.map((c) => `${c.name} (${c.health.score})`).join(', ') || 'none'}.`,
    `Upsell candidates: ${digest.upsellCandidates.map((c) => c.name).join(', ') || 'none'}.`,
    `Failed-payment (churn) signal: ${digest.churn.failedInvoices} in ${digest.churn.windowHours}h.`,
  ].join('\n');

  const res = await chat({
    messages: [
      {
        role: 'system',
        content:
          'You are a customer-success analyst for the Sentinel Hermes console. Summarise the ' +
          'portfolio health digest in ONE short paragraph (max ~90 words). Be specific about who ' +
          'needs attention and where the upside is. ADVISORY ONLY: never instruct anyone to take an ' +
          'action, issue a refund/credit, or change an account — describe the picture and priorities.',
      },
      { role: 'user', content: facts },
    ],
    temperature: 0.3,
    maxTokens: 300,
  });

  if (!res.ok || !res.content) return { text: null, source: 'unavailable' };
  return { text: res.content.trim(), source: 'model' };
}

function emptyBandCounts(): Record<HealthBand, number> {
  return { thriving: 0, healthy: 0, 'at-risk': 0, critical: 0 };
}

/**
 * Assemble the full customer-health digest. Options allow injecting a clock and a
 * chat function for deterministic tests; both default to real behaviour.
 */
export async function assembleHealthDigest(opts?: {
  now?: number;
  chatFn?: ChatFn;
}): Promise<HealthDigest> {
  const now = opts?.now ?? Date.now();

  const live = await assembleLiveInputs(now);
  const inputs = live ?? MOCK_INPUTS;
  const isLive = live != null;

  // Score every customer + detect upsell.
  const customers: CustomerHealth[] = inputs.map((c) => {
    const health = scoreCustomer(c.signals);
    return { ...c, health, upsell: detectUpsell(c, health) };
  });

  // Worst-first — the digest is a triage tool, so surface the pain at the top.
  customers.sort((a, b) => a.health.score - b.health.score);

  const bandCounts = emptyBandCounts();
  for (const c of customers) bandCounts[c.health.band] += 1;

  const atRisk = customers.filter(
    (c) => c.health.band === 'at-risk' || c.health.band === 'critical',
  );
  const upsellCandidates = customers.filter((c) => c.upsell != null);

  // Top movers — coarse SNAPSHOT proxy off usageTrend (no score history exists).
  const declining = customers
    .filter((c) => c.health.usageTrend === 'declining')
    .sort((a, b) => a.health.score - b.health.score)
    .slice(0, 5);
  const improving = customers
    .filter((c) => c.health.usageTrend === 'improving')
    .sort((a, b) => b.health.score - a.health.score)
    .slice(0, 5);

  const churn = await churnSignal();

  const partial: Omit<HealthDigest, 'narrative' | 'narrativeSource'> = {
    generatedAt: new Date(now).toISOString(),
    live: isLive,
    note: isLive ? undefined : 'mock portfolio (no DB)',
    totals: { customers: customers.length },
    bandCounts,
    customers,
    atRisk,
    upsellCandidates,
    topMovers: { improving, declining },
    churn,
  };

  const narrative = await buildNarrative(partial, opts?.chatFn);

  return { ...partial, narrative: narrative.text, narrativeSource: narrative.source };
}
