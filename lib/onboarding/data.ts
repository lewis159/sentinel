// Onboarding — recent-customer assembler (SERVER-ONLY, mock-safe).
//
// Produces the OnboardingCustomer snapshots the pure progress model consumes,
// newest signups first. DB-first, with a plausible mock fallback so the board
// renders with no database (hasDb === false in dev).
//
// ⚠️  FEATURE-USAGE TELEMETRY IS THIN. The estate has no per-feature usage event
// stream yet, so `usedFeatures` is INFERRED from the coarse signals we do have
// (entitlement quota consumed → they've transcribed; member count → teams). This
// deliberately UNDER-counts, so the "unused features" list errs toward surfacing
// more — safe for a nudge. Wire real usage events here when available.

import 'server-only';
import { hasDb, q } from '@/lib/db';
import { withTenantRls, OPERATOR_IDENTITY } from '@/lib/data';
import { normalizeTier, type FeatureKey } from './tiers';
import {
  computeOnboardingProgress,
  type OnboardingCustomer,
  type OnboardingProgress,
} from './progress';

// How recent counts as "new" for the board — signups within this window.
const RECENT_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Mock customers (no-DB path) ──────────────────────────────────────────────
// Spread across the lifecycle so the board demonstrates every state. Signup
// dates are relative to `now` so "days since" stays meaningful in dev.
function mockCustomers(now: Date): OnboardingCustomer[] {
  const daysAgo = (d: number) => new Date(now.getTime() - d * MS_PER_DAY).toISOString();
  return [
    {
      id: 'acme',
      name: 'Acme Co',
      email: 'ops@acme.co',
      tier: 'pro',
      signupAt: daysAgo(2),
      memberCount: 3,
      hasFirstJob: true,
      jobCount: 12,
      usedFeatures: ['transcribe', 'ai_summary'] as FeatureKey[],
      contactedSupport: true,
    },
    {
      id: 'northwind',
      name: 'Northwind Labs',
      email: 'ops@northwind.io',
      tier: 'studio',
      signupAt: daysAgo(9),
      memberCount: 1,
      hasFirstJob: true,
      jobCount: 2,
      usedFeatures: ['transcribe'] as FeatureKey[],
      contactedSupport: true,
    },
    {
      id: 'globex',
      name: 'Globex Media',
      email: 'it@globex.com',
      tier: 'studio',
      signupAt: daysAgo(11),
      memberCount: null, // unknown
      hasFirstJob: false,
      jobCount: 0,
      usedFeatures: [] as FeatureKey[],
      contactedSupport: false,
    },
    {
      id: 'initech',
      name: 'Initech',
      email: 'hello@initech.com',
      tier: 'starter',
      signupAt: daysAgo(1),
      memberCount: 1,
      hasFirstJob: null, // unknown — brand new, no data yet
      jobCount: null,
      usedFeatures: [] as FeatureKey[],
      contactedSupport: null,
    },
  ];
}

// Infer used features from the coarse signals available today (see file header).
function inferUsedFeatures(opts: {
  quotaUsed: number | null;
  memberCount: number | null;
}): FeatureKey[] {
  const used: FeatureKey[] = [];
  if ((opts.quotaUsed ?? 0) > 0) used.push('transcribe');
  if ((opts.memberCount ?? 0) > 1) used.push('teams');
  return used;
}

// DB path: recent orgs (mirror of Clerk orgs) → snapshots. Best-effort; any
// failure returns [] so the caller falls back to the mock set.
async function dbCustomers(now: Date): Promise<OnboardingCustomer[]> {
  return withTenantRls(async () => {
    try {
      const since = new Date(now.getTime() - RECENT_DAYS * MS_PER_DAY).toISOString();
      const orgs = await q<any>(
        `select id, name, created_at from ops.orgs
          where created_at >= $1
          order by created_at desc
          limit 24`,
        [since],
      );
      if (orgs.length === 0) return [];

      const out: OnboardingCustomer[] = [];
      for (const org of orgs) {
        const members = await q<{ clerk_user_id: string }>(
          `select clerk_user_id from ops.org_members where org_id = $1`,
          [org.id],
        );
        const memberIds = members.map((m) => m.clerk_user_id);
        let tier: string | null = null;
        let quotaUsed: number | null = null;
        if (memberIds.length) {
          const ents = await q<any>(
            `select tier, quota_used from ops.app_entitlements where clerk_user_id = any($1)`,
            [memberIds],
          );
          for (const e of ents) {
            if (e.tier && !tier) tier = e.tier;
            const used = e.quota_used == null ? null : Number(e.quota_used);
            if (used != null) quotaUsed = Math.max(quotaUsed ?? 0, used);
          }
        }
        const memberCount = members.length || null;
        out.push({
          id: org.id,
          name: org.name ?? org.id,
          email: null,
          tier: normalizeTier(tier),
          signupAt:
            org.created_at instanceof Date
              ? org.created_at.toISOString()
              : org.created_at ?? null,
          memberCount,
          hasFirstJob: quotaUsed == null ? null : quotaUsed > 0,
          jobCount: quotaUsed,
          usedFeatures: inferUsedFeatures({ quotaUsed, memberCount }),
          contactedSupport: null,
        });
      }
      return out;
    } catch {
      return [];
    }
  }, OPERATOR_IDENTITY);
}

// The board feed: recent customers, most-recently-signed-up first, each with a
// fully-computed onboarding progress view.
export async function getOnboardingBoard(
  now: Date = new Date(),
): Promise<{ customers: OnboardingProgress[]; live: boolean }> {
  let customers: OnboardingCustomer[] = [];
  let live = false;

  if (hasDb) {
    customers = await dbCustomers(now);
    live = customers.length > 0;
  }
  if (customers.length === 0) {
    customers = mockCustomers(now);
    live = false;
  }

  const progress = customers
    .map((c) => computeOnboardingProgress(c, now))
    // Stalled / low-progress first so the operator sees who needs a nudge.
    .sort((a, b) => a.firstSuccessPct - b.firstSuccessPct);

  return { customers: progress, live };
}

// Single customer by id (for the POST/draft path). null when not found.
export async function getOnboardingCustomer(
  id: string,
  now: Date = new Date(),
): Promise<OnboardingProgress | null> {
  const { customers } = await getOnboardingBoard(now);
  return customers.find((c) => c.customerId === id) ?? null;
}
