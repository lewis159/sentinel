// Watchers — a durable cron that checks estate health signals (failing deploys,
// budget breaches; churn-spike hook left extensible) and, on a trip, broadcasts a
// headline and opens a DRAFT proposal for a human.
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
//   (churn-spike is scaffolded: add a real metric read here when the signal lands.)
//
// IDEMPOTENCY: within one run, each signal read + the broadcast + the proposal are
// separate named steps, so a retry/replay re-uses memoized results (exactly-once
// per run). NOTE: de-duping across SEPARATE cron invocations (so an ongoing
// failure doesn't open a fresh proposal every 30 min) needs a persistent
// "last-seen" marker — deliberately out of scope here; see the forward note.
import { inngest, type StepLike } from '@/lib/inngest/client';
import { saveProposal } from '@/lib/hermes/proposals';
import { getDeployStatusTool } from '@/lib/hermes/brain/tools/deploy';
import { broadcastStatusTool } from '@/lib/hermes/brain/tools/broadcast';
import { checkBudget } from '@/lib/hermes/budget';
import type { ToolContext } from '@/lib/hermes/brain/tools/types';

const CTX: ToolContext = {
  threadId: 'inngest:watchers',
  persona: 'pa',
  actor: 'inngest:watchers',
};

type Trip = { signal: string; detail: string };

export async function watchersHandler({
  step,
}: {
  step: Pick<StepLike, 'run'>;
}): Promise<{ trips: Trip[]; proposalId?: string | null }> {
  const trips: Trip[] = [];

  // --- Signal 1: failing deploys ------------------------------------------
  const deploy = await step.run('check-deploys', async () => {
    const res = await getDeployStatusTool.run({}, CTX);
    const rows = Array.isArray(res.data) ? (res.data as any[]) : [];
    const failing = rows
      .filter((r) => r?.latestRun && (r.latestRun.conclusion === 'failure' || r.latestRun.conclusion === 'timed_out'))
      .map((r) => `${r.repo}: ${r.latestRun.name} on ${r.latestRun.branch}`);
    return { ok: res.ok, failing, summary: res.summary };
  });
  if (deploy.failing.length > 0) {
    trips.push({ signal: 'deploy', detail: `Failing build(s): ${deploy.failing.join('; ')}` });
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
    });
  }

  // --- (Signal 3: churn spike) — scaffolded. Wire a real churn metric read here
  // and push a Trip when it exceeds threshold. Left inert so nothing false-fires.

  if (trips.length === 0) {
    return { trips };
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
