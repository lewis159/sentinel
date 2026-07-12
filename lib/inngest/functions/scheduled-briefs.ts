// Scheduled briefs — durable crons that ask the Brain for periodic operations
// briefs and file them as DRAFT proposals for a human to read/act on.
//
// PERSONA ROUTING (the point of this file): a real exec brief is not one generic
// PA turn. The WEEKLY brief invokes the RIGHT exec personas and assembles their
// sections into ONE combined proposal:
//   • Finance (CFO)   → persona 'billing' — the estate's CFO profile (money:
//                       failed payments/dunning, refunds, spend/budget, at-risk MRR).
//   • Operations(COO) → persona 'ceo'     — the Chief-of-Staff/COO profile whose
//                       job IS the weekly review (incidents, deploy/CI, tickets).
// A cheap DAILY ops digest runs the ops persona only.
//
// Both personas are READ-driven and route through the same Brain graph the PA
// uses (runPaTurn). They cannot take action from here — any gated tool they might
// reach for interrupts for approval and never executes inside a cron. Everything
// this file produces is a DRAFT artifact in the Approvals queue, nothing more.
//
// NOTE on the CFO persona: 'billing' is a copilot persona (its SOUL leans toward a
// structured recommendation). Its reply is captured verbatim as the Finance
// section — a human reads it in the queue. TODO(cfo-exec): if a dedicated agentic
// CFO *exec* persona lands, point FINANCE_PERSONA at it for prose-style finance
// briefs; the routing/assembly below does not need to change.
//
// SAFETY — DRAFT ONLY. If the Brain is disabled (HERMES_BRAIN_ENABLED off) the run
// records a skip and files nothing.
//
// IDEMPOTENCY: runs are keyed by ISO week (weekly) / ISO date (daily); each Brain
// turn and the saveProposal call are wrapped in named steps keyed by that period +
// persona, so a replay re-uses memoized results rather than drafting duplicates.
import { inngest, type StepLike } from '@/lib/inngest/client';
import { runPaTurn } from '@/lib/hermes/brain/graph';
import { saveProposal } from '@/lib/hermes/proposals';

// --- persona routing -------------------------------------------------------
const FINANCE_PERSONA = 'billing'; // CFO profile on the shared Brain.
const OPS_PERSONA = 'ceo';         // COO / Chief-of-Staff profile.

const FINANCE_BRIEF_PROMPT =
  "Produce this week's FINANCE brief for the estate as the CFO: summarise failed " +
  'payments / dunning in flight, any refunds or credits, spend against budget caps, ' +
  'and revenue that looks at risk. Call out anything that needs a decision. Keep it ' +
  'to a short scannable bullet list. Do NOT take any action — this is a read-only summary.';

const OPS_BRIEF_PROMPT =
  "Produce this week's OPERATIONS brief for the estate as the COO/Chief-of-Staff: " +
  'summarise open/at-risk incidents, deploy/CI health, notable tickets, what shipped ' +
  'and what slipped, and anything that needs my attention. Keep it to a short scannable ' +
  'bullet list. Do NOT take any action — this is a read-only summary.';

const DAILY_OPS_PROMPT =
  'Produce a SHORT daily operations digest for the estate as the COO: only the ' +
  'headline changes since yesterday — new/at-risk incidents, any red builds, and ' +
  'anything urgent. 3-6 bullets max. Do NOT take any action — this is a read-only summary.';

// Deterministic ISO-week key so the weekly brief is one-per-week even across replays.
function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Deterministic ISO date key (UTC) for the daily digest.
function isoDateKey(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// Result of one persona's brief turn: either a section body or a skip/error note.
type Section = { persona: string; label: string; body: string; status: string };

// Run one persona's brief turn as a named step and normalise the outcome. Never
// throws — a disabled/errored/empty turn becomes a Section carrying that status,
// so one persona failing never sinks the whole brief.
async function runBriefSection(
  step: Pick<StepLike, 'run'>,
  opts: { stepId: string; threadId: string; persona: string; label: string; prompt: string },
): Promise<Section> {
  const turn = await step.run(opts.stepId, async () =>
    runPaTurn({
      threadId: opts.threadId,
      message: opts.prompt,
      persona: opts.persona,
      actor: 'inngest:scheduled-briefs',
    }),
  );
  if (turn.status === 'disabled') {
    return { persona: opts.persona, label: opts.label, body: '', status: 'disabled' };
  }
  if (turn.status === 'error') {
    return {
      persona: opts.persona,
      label: opts.label,
      body: `_(the ${opts.label} brief errored: ${turn.error})_`,
      status: `error:${turn.error}`,
    };
  }
  const reply = 'reply' in turn ? turn.reply : '';
  return {
    persona: opts.persona,
    label: opts.label,
    body: reply || `_(the ${opts.label} brief came back empty)_`,
    status: 'answered',
  };
}

// Assemble sections into one markdown brief body.
function assemble(sections: Section[]): string {
  return sections.map((s) => `## ${s.label}\n\n${s.body}`).join('\n\n');
}

// ---------------------------------------------------------------------------
// WEEKLY brief — finance (CFO) + ops (COO) → one combined DRAFT proposal.
// ---------------------------------------------------------------------------
export async function scheduledBriefsHandler({
  step,
}: {
  step: Pick<StepLike, 'run'>;
}): Promise<{ week: string; status: string; proposalId?: string | null; personas: string[] }> {
  const week = isoWeekKey();

  const finance = await runBriefSection(step, {
    stepId: `brief-finance-${week}`,
    threadId: `brief:finance:${week}`,
    persona: FINANCE_PERSONA,
    label: 'Finance (CFO)',
    prompt: FINANCE_BRIEF_PROMPT,
  });
  const ops = await runBriefSection(step, {
    stepId: `brief-ops-${week}`,
    threadId: `brief:ops:${week}`,
    persona: OPS_PERSONA,
    label: 'Operations (COO)',
    prompt: OPS_BRIEF_PROMPT,
  });

  const sections = [finance, ops];
  // If EVERY persona reported the Brain disabled, there is nothing to file.
  if (sections.every((s) => s.status === 'disabled')) {
    return { week, status: 'skipped-brain-disabled', personas: [FINANCE_PERSONA, OPS_PERSONA] };
  }
  // File the sections that produced content (drop disabled ones from the body).
  const filed = sections.filter((s) => s.status !== 'disabled');
  const body = assemble(filed);

  const proposalId = await step.run(`file-brief-${week}`, async () =>
    saveProposal({
      ref: `brief:${week}`,
      agent: 'pa',
      kind: 'brief',
      title: `Weekly operations brief — ${week}`,
      summary: `Automated weekly brief for ${week} (Finance + Operations). Review in the queue.`,
      proposal: {
        ok: true,
        configured: true,
        classification: `Scheduled brief · ${week}`,
        draft: body || '(the Brain returned empty briefs)',
        reasoning:
          'Weekly cron brief assembled from the CFO (billing) and COO (ceo) personas. ' +
          'Read-only — no action attached.',
      },
    }),
  );

  return {
    week,
    status: 'filed',
    proposalId,
    personas: filed.map((s) => s.persona),
  };
}

export const scheduledBriefs = inngest.createFunction(
  {
    id: 'scheduled-weekly-brief',
    name: 'Scheduled — weekly operations brief',
    // Monday 08:00 Europe/London. Inngest supports a TZ= prefix on cron expressions.
    triggers: [{ cron: 'TZ=Europe/London 0 8 * * 1' }],
  },
  async ({ step }) => scheduledBriefsHandler({ step }),
);

// ---------------------------------------------------------------------------
// DAILY ops digest — ops (COO) persona only, one short DRAFT proposal. Cheap: a
// single Brain turn per day.
// ---------------------------------------------------------------------------
export async function scheduledDailyDigestHandler({
  step,
}: {
  step: Pick<StepLike, 'run'>;
}): Promise<{ date: string; status: string; proposalId?: string | null }> {
  const date = isoDateKey();

  const ops = await runBriefSection(step, {
    stepId: `digest-ops-${date}`,
    threadId: `digest:ops:${date}`,
    persona: OPS_PERSONA,
    label: 'Daily ops digest',
    prompt: DAILY_OPS_PROMPT,
  });

  if (ops.status === 'disabled') {
    return { date, status: 'skipped-brain-disabled' };
  }

  const proposalId = await step.run(`file-digest-${date}`, async () =>
    saveProposal({
      ref: `digest:${date}`,
      agent: 'pa',
      kind: 'brief',
      title: `Daily ops digest — ${date}`,
      summary: `Automated daily ops digest for ${date}. Review in the queue.`,
      proposal: {
        ok: true,
        configured: true,
        classification: `Daily digest · ${date}`,
        draft: ops.body,
        reasoning:
          'Daily cron digest generated by the COO (ceo) persona. Read-only — no action attached.',
      },
    }),
  );

  return { date, status: 'filed', proposalId };
}

export const scheduledDailyDigest = inngest.createFunction(
  {
    id: 'scheduled-daily-ops-digest',
    name: 'Scheduled — daily ops digest',
    // 07:30 Europe/London, Monday–Friday (skip the weekend).
    triggers: [{ cron: 'TZ=Europe/London 30 7 * * 1-5' }],
  },
  async ({ step }) => scheduledDailyDigestHandler({ step }),
);
