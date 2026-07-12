// Persistence for Hermes agent proposals → the approval queue.
//
// Copilot-first: a Hermes agent DRAFTS a proposal (e.g. a customer reply) and
// we persist it here so a human can approve/dismiss it from the queue. Approving
// a draft posts it to the ticket as a reply.
//
// No DB in dev (hasDb === false) → every function degrades to a no-op so the
// queue simply reads empty. Real persistence happens in prod.
import 'server-only';
import { hasDb, q, q1 } from '@/lib/db';
import { addTicketComment } from '@/lib/data';
import type { HermesProposal } from '@/lib/hermes/types';
import { claimExecution, recordResult, getExecution } from '@/lib/hermes/exec-ledger';
import { appendAudit } from '@/lib/hermes/audit';

export type HermesProposalRecord = {
  id: string;
  ref: string;
  agent: string;
  kind: string;
  title: string;
  summary: string;
  proposal: HermesProposal;
  status: 'pending' | 'sent' | 'dismissed';
  createdAt: string;
};

// Lazily create the table on the write path so prod doesn't hard-depend on the
// migration having run first (belt-and-braces, mirrors lib/hermes/config.ts).
// gen_random_uuid()/pgcrypto is available like the other ops.* tables.
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.hermes_proposals (
       id          uuid default gen_random_uuid() primary key,
       ref         text,
       agent       text,
       kind        text,
       title       text,
       summary     text,
       proposal    jsonb,
       status      text default 'pending',
       created_at  timestamptz default now(),
       decided_at  timestamptz,
       decided_by  text
     )`,
  );
}

function mapRow(r: any): HermesProposalRecord {
  const proposal =
    typeof r.proposal === 'string'
      ? (JSON.parse(r.proposal) as HermesProposal)
      : (r.proposal as HermesProposal);
  return {
    id: r.id,
    ref: r.ref ?? '',
    agent: r.agent ?? '',
    kind: r.kind ?? '',
    title: r.title ?? '',
    summary: r.summary ?? '',
    proposal,
    status: (r.status ?? 'pending') as HermesProposalRecord['status'],
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ''),
  };
}

/**
 * Persist a proposal and return its new id. No-op (returns null) with no DB.
 */
export async function saveProposal(p: {
  ref: string;
  agent: string;
  kind: string;
  title: string;
  summary: string;
  proposal: HermesProposal;
}): Promise<string | null> {
  if (!hasDb) return null;
  try {
    await ensureTable();
    const row = await q1<{ id: string }>(
      `insert into ops.hermes_proposals (ref, agent, kind, title, summary, proposal)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       returning id`,
      [
        p.ref,
        p.agent,
        p.kind,
        p.title,
        p.summary,
        JSON.stringify(p.proposal),
      ],
    );
    // P3 audit: record the birth of the proposal so the immutable chain covers the
    // full lifecycle (created → approved/executed/dismissed). Mock-safe no-op w/o DB.
    await appendAudit({
      actor: p.agent,
      action: 'proposal.created',
      proposalId: row?.id ?? null,
      tool: p.proposal.action?.tool ?? null,
      summary: `Proposal created (${p.kind}) by ${p.agent}`,
      detail: { kind: p.kind, ref: p.ref, title: p.title },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * List proposals, newest first. Optional status filter; default limit 50.
 * Empty array with no DB or on error.
 */
export async function listProposals(opts?: {
  status?: string;
  limit?: number;
}): Promise<HermesProposalRecord[]> {
  if (!hasDb) return [];
  const limit = opts?.limit ?? 50;
  try {
    await ensureTable();
    const rows = opts?.status
      ? await q<any>(
          `select id, ref, agent, kind, title, summary, proposal, status, created_at
             from ops.hermes_proposals
            where status = $1
            order by created_at desc
            limit $2`,
          [opts.status, limit],
        )
      : await q<any>(
          `select id, ref, agent, kind, title, summary, proposal, status, created_at
             from ops.hermes_proposals
            order by created_at desc
            limit $1`,
          [limit],
        );
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * Queue feed for the approval UI. Returns PENDING proposals first, then the most
 * recently-decided rows (sent/dismissed) so the operator can still see WHAT just
 * executed — newest-first within each group. Decided rows render read-only in the
 * queue. Empty array with no DB or on error. Default limit 50.
 */
export async function getHermesProposals(opts?: {
  limit?: number;
}): Promise<HermesProposalRecord[]> {
  if (!hasDb) return [];
  const limit = opts?.limit ?? 50;
  try {
    await ensureTable();
    const rows = await q<any>(
      `select id, ref, agent, kind, title, summary, proposal, status, created_at
         from ops.hermes_proposals
        order by (status <> 'pending'), created_at desc
        limit $1`,
      [limit],
    );
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * Fetch a single proposal by id. Null with no DB, if not found, or on error.
 */
export async function getHermesProposal(
  id: string,
): Promise<HermesProposalRecord | null> {
  if (!hasDb) return null;
  try {
    await ensureTable();
    const row = await q1<any>(
      `select id, ref, agent, kind, title, summary, proposal, status, created_at
         from ops.hermes_proposals
        where id = $1`,
      [id],
    );
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * Persist a Brain gated-action proposal (the interrupt → proposal half of the
 * action spine). Carries the pending tool call inside `proposal.action` so the
 * Approve path can resume the graph and run the tool for real. Returns the id.
 */
export async function saveActionProposal(p: {
  ref: string;
  agent: string;
  title: string;
  summary: string;
  tool: string;
  args: Record<string, unknown>;
  threadId: string;
  callId?: string;
  persona?: string;
  describe?: string;
}): Promise<string | null> {
  const proposal: HermesProposal = {
    ok: true,
    configured: true,
    classification: p.describe ?? `${p.tool} (pending approval)`,
    draft: p.describe,
    reasoning: `Gated tool "${p.tool}" is awaiting your approval before it runs.`,
    action: {
      tool: p.tool,
      args: p.args,
      threadId: p.threadId,
      callId: p.callId,
      persona: p.persona,
    },
  };
  return saveProposal({
    ref: p.ref,
    agent: p.agent,
    kind: 'action',
    title: p.title,
    summary: p.summary,
    proposal,
  });
}

/**
 * Act on a proposal from the approval queue.
 *   - approve:    ACTION proposals (proposal.action present) → resume the paused
 *                 Brain graph and RUN the gated tool for real, then record the
 *                 result + decision. DRAFT proposals → post the draft to the
 *                 ticket as a reply (legacy copilot behaviour). Either way → sent.
 *   - mark-sent:  mark sent WITHOUT posting (reply already sent elsewhere).
 *   - dismiss:    ACTION proposals → resume the graph with a rejection so the
 *                 agent can respond; then mark dismissed. DRAFT → just dismiss.
 */
export async function actOnProposal(
  id: string,
  action: 'approve' | 'dismiss' | 'mark-sent',
  by: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasDb) return { ok: false, error: 'no database in this environment' };
  try {
    await ensureTable();
    const rec = await q1<any>(
      `select id, ref, proposal from ops.hermes_proposals where id = $1`,
      [id],
    );
    if (!rec) return { ok: false, error: 'proposal not found' };

    const proposal: HermesProposal =
      typeof rec.proposal === 'string' ? JSON.parse(rec.proposal) : rec.proposal;
    const isAction = Boolean(proposal?.action?.tool && proposal?.action?.threadId);

    if (action === 'approve') {
      if (isAction) {
        // --- P3 exactly-once gate ------------------------------------------
        // A double-approve / retried request must run the money/account tool AT
        // MOST ONCE. The idempotency key is stable per approval: the proposal id
        // plus the interrupted tool_call id (falling back to the tool name when a
        // callId wasn't captured). claimExecution INSERTs that key under a UNIQUE
        // constraint — exactly one caller wins; the loser stands down and returns
        // the prior recorded outcome WITHOUT re-running the tool.
        const idemKey = `${id}:${proposal.action!.callId ?? proposal.action!.tool}`;
        const claim = await claimExecution(idemKey, id, proposal.action!.tool);
        if (!claim.won) {
          // Already claimed → do NOT execute again. Surface the prior result.
          const prior = await getExecution(idemKey);
          if (prior && prior.status === 'failed') {
            return { ok: false, error: 'this proposal was already executed (prior attempt failed)' };
          }
          return { ok: true };
        }

        // We won the claim → resume the paused graph and execute for real.
        const { resumeThread } = await import('@/lib/hermes/brain/graph');
        const res = await resumeThread({
          threadId: proposal.action!.threadId,
          decision: { approved: true, by },
        });
        if (res.status === 'error') {
          await recordResult(idemKey, 'failed', { error: res.error });
          return { ok: false, error: res.error };
        }
        if (res.status === 'disabled') {
          await recordResult(idemKey, 'failed', { error: 'brain disabled' });
          return { ok: false, error: 'Hermes Brain is disabled (HERMES_BRAIN_ENABLED)' };
        }
        await recordResult(idemKey, 'succeeded', { toolResult: res.toolResult });

        // Persist the execution result back onto the proposal for audit/history.
        const executed: HermesProposal = {
          ...proposal,
          action: { ...proposal.action!, result: res.toolResult, executedAt: new Date().toISOString() },
        };
        await q(
          `update ops.hermes_proposals
              set status = 'sent', decided_at = now(), decided_by = $2, proposal = $3::jsonb
            where id = $1`,
          [id, by, JSON.stringify(executed)],
        );
        await appendAudit({
          actor: by,
          action: 'proposal.executed',
          proposalId: id,
          tool: proposal.action!.tool,
          summary: `Approved & executed ${proposal.action!.tool} by ${by}`,
          detail: { action, result: res.toolResult ?? null },
        });
        return { ok: true };
      }

      if (proposal?.draft && rec.ref) {
        await addTicketComment(rec.ref, proposal.draft, by, 'reply');
      }
      await q(
        `update ops.hermes_proposals
            set status = 'sent', decided_at = now(), decided_by = $2
          where id = $1`,
        [id, by],
      );
      await appendAudit({
        actor: by,
        action: 'proposal.approved',
        proposalId: id,
        tool: proposal.action?.tool ?? null,
        summary: `Approved ${proposal.action?.tool ?? 'proposal'} by ${by}`,
        detail: { action },
      });
      return { ok: true };
    }

    if (action === 'mark-sent') {
      await q(
        `update ops.hermes_proposals
            set status = 'sent', decided_at = now(), decided_by = $2
          where id = $1`,
        [id, by],
      );
      await appendAudit({
        actor: by,
        action: 'proposal.approved',
        proposalId: id,
        tool: proposal.action?.tool ?? null,
        summary: `Marked sent (no post) by ${by}`,
        detail: { action },
      });
      return { ok: true };
    }

    // dismiss — for an ACTION proposal, resume the graph with a rejection so the
    // agent replies accordingly (best-effort; we still mark it dismissed).
    if (isAction) {
      try {
        const { resumeThread } = await import('@/lib/hermes/brain/graph');
        await resumeThread({
          threadId: proposal.action!.threadId,
          decision: { approved: false, by, reason: 'declined from the approval queue' },
        });
      } catch {
        /* best-effort — dismissal still records below */
      }
    }
    await q(
      `update ops.hermes_proposals
          set status = 'dismissed', decided_at = now(), decided_by = $2
        where id = $1`,
      [id, by],
    );
    await appendAudit({
      actor: by,
      action: 'proposal.dismissed',
      proposalId: id,
      tool: proposal.action?.tool ?? null,
      summary: `Dismissed ${proposal.action?.tool ?? 'proposal'} by ${by}`,
      detail: { action },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'failed to act on proposal' };
  }
}
