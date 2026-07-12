// Watchers — a durable cron that checks estate health signals (failing deploys,
// budget breaches, and a churn spike) and, on a trip, broadcasts a headline and
// opens a DRAFT proposal for a human.
//
// Trigger: every 30 minutes.
//
// SAFETY — DRAFT / GATED ONLY. The only outbound action is a status broadcast to
// the #pa-status channel (an informational nudge via the existing broadcast tool,
// which itself no-ops when unconfigured). Any REMEDIATION is filed as a proposal
// via saveProposal — never executed here. Nothing money- or account-moving runs.
//
// Signals read (all via EXISTING, read-only paths — we import + call, we don't
// reimplement):
//   • getDeployStatusTool  — latest GitHub Actions run per estate repo (failing?).
//   • checkBudget          — is a Hermes spend cap already breached?
//   • churnSignal          — failed-payment proxy for a churn spike (see
//                            lib/inngest/signals/churn.ts for the source + the
//                            real-source TODO).
//
// IDEMPOTENCY (two layers):
//   1. Within one run: each signal read + the broadcast + the proposal are separate
//      named steps, so a retry/replay re-uses memoized results (exactly-once/run).
//   2. ACROSS runs: a persistent "last-seen" marker (ops.hermes_watcher_state via
//      claimWatcherAlert) de-dups an ONGOING condition so we don't re-broadcast +
//      re-file every 30 min. We alert only when the condition's coarse fingerprint
//      changes OR a cooldown elapses. This closes the gap the earlier scaffold
//      flagged as out-of-scope.
import { inngest, type StepLike } from '@/lib/inngest/client';
import { saveProposal } from '@/lib/hermes/proposals';
import { getDeployStatusTool } from '@/lib/hermes/brain/tools/deploy';
import { broadcastStatusTool } from '@/lib/hermes/brain/tools/broadcast';
import { checkBudget } from '@/lib/hermes/budget';
import { churnSignal } from '@/lib/inngest/signals/churn';
import { claimWatcherAlert } from '@/lib/inngest/signals/watcher-state';
import type { ToolContext } from '@/lib/hermes/brain/tools/types';

const CTX: ToolContext = {
  threadId: 'inngest:watchers',
  persona: 'pa',
  actor: 'inngest:watchers',
};

const WATCHER_SIGNAL_KEY = 'estate-watchers';

// A trip carries a human `detail` line plus a COARSE `fp` fragment. The fp is what
// feeds the cross-run de-dup fingerprint — it must be low-resolution so small
// fluctuations (an extra stale PR, a churn count wobble) don't re-fire the alert.
type Trip = { signal: string; detail: string; fp: string };

export async function watchersHandler({
  step,
}: {
  step: Pick<StepLike, 'run'>;
}): Promise<{ trips: Trip[]; proposalId?: string | null; deduped?: boolean }> {
  const trips: Trip[] = [];

  // --- Signal 1: failing deploys ------------------------------------------
  const deploy = await step.run('check-deploys', async () => {
    const res = await getDeployStatusTool.run({}, CTX);
    const rows = Array.isArray(res.data) ? (res.data as any[]) : [];
    const failing = rows
      .filter((r) => r?.latestRun && (r.latestRun.conclusion === 'failure' || r.latestRun.conclusion === 'timed_out'))
      .map((r) => `${r.repo}: ${r.latestRun.name} on ${r.latestRun.branch}`);
    // Coarse fp = the sorted set of failing repos (not the run names/branches), so
    // the same repos staying red keeps one stable fingerprint.
    const repos = rows
      .filter((r) => r?.latestRun && (r.latestRun.conclusion === 'failure' || r.latestRun.conclusion === 'timed_out'))
      .map((r) => r.repo)
      .sort();
    return { ok: res.ok, failing, repos, summary: res.summary };
  });
  if (deploy.failing.length > 0) {
    trips.push({
      signal: 'deploy',
      detail: `Failing build(s): ${deploy.failing.join('; ')}`,
      fp: `deploy:${deploy.repos.join(',')}`,
    });
  }

  // --- Signal 2: budget breach --------------------------------------------
  // Ask whether the PA's spend cap is ALREADY exceeded (est 0 → allowed is false
  // only when recorded spend already sits above the cap). Uncapped → never trips.
  const budget = await step.run('check-budget', async () => {
    const d = await checkBudget('pa', '*', 0, 'global');
    return {
      breached: !d.allowed && !d.uncapped,
      capMinor: d.capMinor,
      spentMinor: d.spentMinor,
      reason: d.reason,
    };
  });
  if (budget.breached) {
    trips.push({
      signal: 'budget',
      detail: `Budget cap breached (spent ${budget.spentMinor} / cap ${budget.capMinor}).`,
      fp: 'budget:breached',
    });
  }

  // --- Signal 3: churn spike ----------------------------------------------
  // Failed-payment proxy (see lib/inngest/signals/churn.ts). Trips when distinct
  // failed invoices in the window exceed the threshold. The fp carries only the
  // coarse severity bucket so count jitter doesn't re-spam the alert.
  const churn = await step.run('check-churn', async () => churnSignal());
  if (churn.tripped) {
    trips.push({
      signal: 'churn',
      detail: churn.detail,
      fp: `churn:${churn.severity}`,
    });
  }

  if (trips.length === 0) {
    return { trips };
  }

  // --- Cross-run de-dup gate ----------------------------------------------
  // Build a coarse fingerprint over the tripped signals. If the SAME condition
  // persists (identical fingerprint) within the cooldown, claimWatcherAlert refuses
  // and we return WITHOUT broadcasting or filing — so an ongoing red build or
  // sustained churn doesn't open a fresh proposal every tick.
  const fingerprint = trips
    .map((t) => t.fp)
    .sort()
    .join('|');
  const fresh = await step.run('dedup-claim', async () =>
    claimWatcherAlert(WATCHER_SIGNAL_KEY, fingerprint, undefined, {
      signals: trips.map((t) => t.signal),
    }),
  );
  if (!fresh) {
    // Already alerted for this exact condition inside the cooldown window.
    return { trips, deduped: true };
  }

  const headline = `Sentinel watcher: ${trips.map((t) => t.signal).join(', ')} tripped — ${
    trips.length
  } issue(s) need review.`;

  // Broadcast the headline (informational; broadcast tool no-ops when unconfigured).
  await step.run('broadcast', async () => broadcastStatusTool.run({ text: headline }, CTX));

  // Open a single DRAFT proposal summarising the trips. No action attached → the
  // Approvals queue shows it read-only for a human to triage/remediate manually.
  const proposalId = await step.run('open-proposal', async () =>
    saveProposal({
      ref: 'inngest:watchers',
      agent: 'pa',
      kind: 'watcher',
      title: `Estate watcher alert — ${trips.map((t) => t.signal).join(', ')}`,
      summary: headline,
      proposal: {
        ok: true,
        configured: true,
        classification: `Watcher · ${trips.map((t) => t.signal).join('+')}`,
        priority: 'high',
        draft: trips.map((t) => `• [${t.signal}] ${t.detail}`).join('\n'),
        reasoning:
          'Automated watcher tripped on the signals above. Filed for human review — no remediation was executed.',
      },
    }),
  );

  return { trips, proposalId };
}

export const watchers = inngest.createFunction(
  {
    id: 'estate-watchers',
    name: 'Watchers — estate health signals',
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step }) => watchersHandler({ step }),
);
