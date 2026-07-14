// On-demand LIVE smoke checks for the Hermes platform.
//
// These prove the *deployed, running* app actually works end-to-end against its
// own process + DB + config — distinct from the unit/integration suite (which runs
// in CI). They are invoked from the admin Testing hub (POST /api/v2/admin/smoke)
// and are designed to be SAFE TO RUN AGAINST PRODUCTION:
//
//   • Read-mostly. The only writes are self-created, clearly test-tagged artifacts
//     that are deleted in the SAME run (a proposal ref prefixed `__smoke__` that is
//     dismissed; a `__smoke__:exec:` ledger row that is deleted).
//   • NEVER fires a real external side-effect. The action-tool checks only exercise
//     the `not_configured` guard path, and SKIP (never call run()) whenever a real
//     key is present — so no real Stripe refund / Resend send / GitHub deploy can
//     ever happen from a smoke run.
//   • Every check is wrapped so a throw becomes a `fail` result — the runner never
//     crashes on one bad check.
//
// Each check returns { name, status: 'pass'|'fail'|'skip', detail, ms }. `skip`
// means "not applicable in this environment" (e.g. no DB, brain disabled, or a real
// key is present so we won't touch the network) — it is NOT a failure.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { hasDb, q, q1 } from '@/lib/db';
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { inngestEnabled } from '@/lib/inngest/client';
import { getHermesRuntimeConfig } from '@/lib/hermes/config';
import { runPaTurn } from '@/lib/hermes/brain/graph';
import { saveActionProposal, getHermesProposal, actOnProposal } from '@/lib/hermes/proposals';
import { claimExecution, getExecution, recordResult } from '@/lib/hermes/exec-ledger';
import { verifyChain } from '@/lib/hermes/audit';
import { getSecret } from '@/lib/secrets';
import { refundChargeTool } from '@/lib/hermes/brain/tools/stripe';
import { sendEmailTool } from '@/lib/hermes/brain/tools/email';
import { triggerWorkflowTool } from '@/lib/hermes/brain/tools/github';
import type { BrainTool } from '@/lib/hermes/brain/tools/types';

export type SmokeStatus = 'pass' | 'fail' | 'skip';
export type SmokeCheck = {
  name: string;
  status: SmokeStatus;
  detail: string;
  ms: number;
};
export type SmokeSummary = {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  ok: boolean; // true when nothing FAILED (skips are fine)
};
export type SmokeRun = {
  ranAt: string;
  ms: number;
  summary: SmokeSummary;
  checks: SmokeCheck[];
};

// A named check implementation. Returns everything but the timing/name, which the
// `safe()` wrapper stamps on. Any throw is caught by `safe()` → a `fail` result.
type CheckImpl = () => Promise<{ status: SmokeStatus; detail: string }>;

// Wrap a check so it can NEVER crash the runner: a throw becomes a `fail` with the
// error message, and every result carries its name + elapsed ms.
export async function safe(name: string, impl: CheckImpl): Promise<SmokeCheck> {
  const t0 = Date.now();
  try {
    const { status, detail } = await impl();
    return { name, status, detail, ms: Date.now() - t0 };
  } catch (e: any) {
    return {
      name,
      status: 'fail',
      detail: `threw: ${e?.message ?? String(e)}`,
      ms: Date.now() - t0,
    };
  }
}

// --- 1. DB reachable -------------------------------------------------------
export const dbReachableCheck: CheckImpl = async () => {
  if (!hasDb) return { status: 'skip', detail: 'no DATABASE_URL — DB features are mock-only here' };
  const row = await q1<{ ok: number }>('select 1 as ok');
  if (row?.ok === 1) return { status: 'pass', detail: 'select 1 → 1 (pool live)' };
  return { status: 'fail', detail: `unexpected select 1 result: ${JSON.stringify(row)}` };
};

// --- 2. Flags (informational — always pass) --------------------------------
export const flagsCheck: CheckImpl = async () => {
  const on = (b: boolean) => (b ? 'on' : 'off');
  let rls = 'unknown';
  if (hasDb) {
    try {
      const row = await q1<{ on: boolean }>(
        `select relrowsecurity as on
           from pg_class
          where relname = 'tickets'
            and relnamespace = 'ops'::regnamespace`,
      );
      rls = row ? (row.on ? 'enabled' : 'disabled') : 'no ops.tickets';
    } catch (e: any) {
      rls = `unreadable (${e?.message ?? 'error'})`;
    }
  } else {
    rls = 'n/a (no DB)';
  }
  // Report the RESOLVED (runtime) value — DB override → env default — so the row
  // reflects reality after an Integrations-page toggle, not just the stack env.
  const [brain, intake, kb] = await Promise.all([
    getRuntimeFlag('HERMES_BRAIN_ENABLED'),
    getRuntimeFlag('HERMES_INTAKE_ENABLED'),
    getRuntimeFlag('HERMES_KB_PGVECTOR'),
  ]);
  const detail =
    `HERMES_BRAIN_ENABLED=${on(brain)} · ` +
    `HERMES_INNGEST_ENABLED=${on(inngestEnabled())} · ` +
    `HERMES_INTAKE_ENABLED=${on(intake)} · ` +
    `HERMES_KB_PGVECTOR=${on(kb)} · ` +
    `ops.tickets RLS=${rls}`;
  return { status: 'pass', detail };
};

// --- 3. Brain replies ------------------------------------------------------
// Skip (NOT fail) when the brain is disabled or there is no model key — those are
// valid deployment states, not smoke failures. When both are present, make one
// trivial turn on a throwaway thread and assert a non-empty reply.
export const brainRepliesCheck: CheckImpl = async () => {
  if (!(await getRuntimeFlag('HERMES_BRAIN_ENABLED')))
    return { status: 'skip', detail: 'HERMES_BRAIN_ENABLED is off — brain routes are inert' };
  const cfg = await getHermesRuntimeConfig();
  if (!cfg.hasKey)
    return { status: 'skip', detail: 'no OpenRouter model key configured — cannot call the model' };

  const threadId = `__smoke__:brain:${randomUUID()}`;
  const res = await runPaTurn({
    threadId,
    message: 'Smoke check — reply with the single word: OK',
    persona: 'pa',
    actor: '__smoke__',
  });
  if (res.status === 'disabled') return { status: 'skip', detail: 'brain reported disabled' };
  if (res.status === 'error') return { status: 'fail', detail: `brain error: ${res.error}` };
  if (res.status === 'pending_approval')
    return { status: 'fail', detail: 'trivial prompt unexpectedly triggered a gated tool' };
  const reply = (res.reply ?? '').trim();
  if (!reply) return { status: 'fail', detail: 'brain answered with an empty reply' };
  return {
    status: 'pass',
    detail: `brain replied (${reply.length} chars, model ${res.model ?? cfg.model}): "${reply.slice(0, 60)}"`,
  };
};

// --- 4. Gated action → proposal (no execute) -------------------------------
// Create a GATED tool proposal via saveActionProposal (test-tagged), assert it
// persists as `pending` with NO executed side-effect (executedAt unset), then clean
// up by dismissing it. Proves the "interrupt → proposal, nothing runs until Approve"
// half of the action spine without ever approving anything.
export const gatedProposalCheck: CheckImpl = async () => {
  if (!hasDb)
    return { status: 'skip', detail: 'no DB — proposals do not persist (mock no-op)' };

  const ref = `__smoke__:${randomUUID()}`;
  const id = await saveActionProposal({
    ref,
    agent: '__smoke__',
    title: '__smoke__ gated proposal (do not approve)',
    summary: 'Live smoke test — a gated updateTicket that must sit pending, never execute.',
    tool: 'updateTicket',
    args: { ref: '__SMOKE_NO_SUCH_TICKET__', comment: 'smoke — should never run' },
    threadId: `__smoke__:thread:${randomUUID()}`,
    describe: 'smoke: gated proposal that is dismissed, never approved',
  });
  if (!id) return { status: 'fail', detail: 'saveActionProposal returned no id (persist failed)' };

  try {
    const rec = await getHermesProposal(id);
    if (!rec) return { status: 'fail', detail: `proposal ${id} not found after save` };
    const action = rec.proposal?.action as { executedAt?: unknown; result?: unknown } | undefined;
    const executed = Boolean(action?.executedAt || action?.result);
    if (rec.status !== 'pending' || executed) {
      return {
        status: 'fail',
        detail: `expected pending + unexecuted, got status=${rec.status} executed=${executed}`,
      };
    }
    return {
      status: 'pass',
      detail: `proposal ${id.slice(0, 8)} pending, executedAt unset, side-effect not run`,
    };
  } finally {
    // CLEANUP — dismiss the test proposal (best-effort; never throws out of here).
    try {
      await actOnProposal(id, 'dismiss', '__smoke__');
    } catch {
      /* leave a dismissed-or-not proposal; it is clearly `__smoke__`-tagged */
    }
  }
};

// --- 5. Exactly-once gate --------------------------------------------------
// The exactly-once property that actOnProposal's double-approve relies on lives in
// claimExecution (the UNIQUE idempotency_key INSERT). We exercise that primitive
// DIRECTLY against the live ledger — deterministic and model-free: claim the same
// key twice, assert the first wins and the second loses, assert EXACTLY ONE ledger
// row exists, then delete the test row. (Driving it through the whole graph would
// need a live model + a genuinely paused thread — too fragile for a health check;
// the gate itself is the invariant, and this is the same code path.)
export const exactlyOnceCheck: CheckImpl = async () => {
  if (!hasDb)
    return { status: 'skip', detail: 'no DB — claimExecution has no ledger to arbitrate (dev wins by default)' };

  const key = `__smoke__:exec:${randomUUID()}`;
  try {
    const first = await claimExecution(key, null, '__smoke_noop__');
    const second = await claimExecution(key, null, '__smoke_noop__');
    // The winner records a result, mirroring a real successful execution.
    await recordResult(key, 'succeeded', { smoke: true });

    const countRow = await q1<{ n: string | number }>(
      'select count(*)::int as n from ops.hermes_tool_executions where idempotency_key = $1',
      [key],
    );
    const n = Number(countRow?.n ?? -1);
    const exec = await getExecution(key);

    const ok = first.won === true && second.won === false && second.alreadyClaimed === true && n === 1;
    if (!ok) {
      return {
        status: 'fail',
        detail: `exactly-once violated: first.won=${first.won} second.won=${second.won} rows=${n} status=${exec?.status}`,
      };
    }
    return {
      status: 'pass',
      detail: `first claim won, second stood down, ledger has exactly 1 row (status ${exec?.status})`,
    };
  } finally {
    // CLEANUP — remove the test ledger row (this table has no append-only guard).
    try {
      await q('delete from ops.hermes_tool_executions where idempotency_key = $1', [key]);
    } catch {
      /* row is clearly `__smoke__:exec:`-tagged if cleanup ever fails */
    }
  }
};

// --- 6. Action tools not_configured-safe -----------------------------------
// For each side-effecting action tool: if its key is ABSENT, call run() with a
// dummy arg and assert it returns `not_configured` WITHOUT throwing (the tool
// returns before any fetch, so no network is touched). If a real key IS present we
// SKIP that tool — we must never fire a real Stripe/Resend/GitHub call from a smoke
// run. The aggregate is `skip` only if every tool was skipped (all keys present).
type ToolProbe = {
  label: string;
  tool: BrainTool<any>;
  envKeys: string[]; // env var names that would configure it
  secretKey: string; // Infisical secret name
  dummyArgs: Record<string, unknown>;
};

const TOOL_PROBES: ToolProbe[] = [
  {
    label: 'stripe/refundCharge',
    tool: refundChargeTool,
    envKeys: ['STRIPE_SECRET_KEY'],
    secretKey: 'STRIPE_SECRET_KEY',
    dummyArgs: { chargeId: '__smoke_no_charge__', amount: 1 },
  },
  {
    label: 'email/sendEmail',
    tool: sendEmailTool,
    envKeys: ['RESEND_API'],
    secretKey: 'RESEND_API',
    dummyArgs: { to: 'smoke@example.invalid', subject: '__smoke__', text: 'noop' },
  },
  {
    label: 'github/triggerWorkflow',
    tool: triggerWorkflowTool,
    envKeys: ['HERMES_GITHUB_TOKEN'],
    secretKey: 'HERMES_GITHUB_TOKEN',
    dummyArgs: { repo: '__smoke__/none', workflowId: 'noop.yml', ref: 'main' },
  },
];

const SMOKE_CTX = { threadId: '__smoke__', persona: '__smoke__', actor: '__smoke__' };

// True when a real key is configured for this tool (env OR Infisical) → we must not
// call run(), to avoid any chance of a real API hit.
async function toolKeyPresent(p: ToolProbe): Promise<boolean> {
  if (p.envKeys.some((k) => Boolean(process.env[k]))) return true;
  try {
    if (await getSecret(p.secretKey)) return true;
  } catch {
    /* getSecret already swallows errors; treat unknown as absent */
  }
  return false;
}

export const actionToolsNotConfiguredCheck: CheckImpl = async () => {
  const tested: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const p of TOOL_PROBES) {
    if (await toolKeyPresent(p)) {
      skipped.push(`${p.label} (key present)`);
      continue;
    }
    const res = await p.tool.run(p.dummyArgs, SMOKE_CTX);
    if (res.ok === false && res.error === 'not_configured') {
      tested.push(p.label);
    } else {
      failed.push(`${p.label} (ok=${res.ok} error=${res.error ?? 'none'})`);
    }
  }

  if (failed.length) {
    return { status: 'fail', detail: `unsafe not_configured path: ${failed.join('; ')}` };
  }
  if (tested.length === 0) {
    return {
      status: 'skip',
      detail: `all action tools have keys present — skipped to avoid real API calls: ${skipped.join(', ')}`,
    };
  }
  const suffix = skipped.length ? ` · skipped (key present): ${skipped.join(', ')}` : '';
  return {
    status: 'pass',
    detail: `not_configured (no network) for: ${tested.join(', ')}${suffix}`,
  };
};

// --- 7. Audit chain --------------------------------------------------------
export const auditChainCheck: CheckImpl = async () => {
  if (!hasDb) return { status: 'skip', detail: 'no DB — audit chain is empty/mock here' };
  const v = await verifyChain();
  if (v.ok) return { status: 'pass', detail: `hash chain intact over ${v.count} row(s)` };
  return {
    status: 'fail',
    detail: `chain broken at seq ${v.brokenAtSeq}: ${v.reason ?? 'mismatch'}`,
  };
};

// The ordered catalog of checks. `name` is the stable id surfaced by the GET route.
export const SMOKE_CHECKS: Array<{ name: string; impl: CheckImpl }> = [
  { name: 'db_reachable', impl: dbReachableCheck },
  { name: 'flags', impl: flagsCheck },
  { name: 'brain_replies', impl: brainRepliesCheck },
  { name: 'gated_proposal_no_execute', impl: gatedProposalCheck },
  { name: 'exactly_once_gate', impl: exactlyOnceCheck },
  { name: 'action_tools_not_configured_safe', impl: actionToolsNotConfiguredCheck },
  { name: 'audit_chain', impl: auditChainCheck },
];

// The stable catalog (names only) for the GET route / UI to render before a run.
export function smokeCatalog(): string[] {
  return SMOKE_CHECKS.map((c) => c.name);
}

// Run every check (each wrapped by safe()) and summarise. Never throws.
export async function runSmokeChecks(): Promise<SmokeRun> {
  const t0 = Date.now();
  const checks: SmokeCheck[] = [];
  // Sequential — the checks are cheap and a couple share the DB/test-artifact space;
  // running them in order keeps the ledger/proposal artifacts from interleaving.
  for (const c of SMOKE_CHECKS) {
    checks.push(await safe(c.name, c.impl));
  }
  const summary: SmokeSummary = {
    total: checks.length,
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    skip: checks.filter((c) => c.status === 'skip').length,
    ok: checks.every((c) => c.status !== 'fail'),
  };
  return {
    ranAt: new Date().toISOString(),
    ms: Date.now() - t0,
    summary,
    checks,
  };
}
