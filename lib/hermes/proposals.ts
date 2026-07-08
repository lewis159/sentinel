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
 * Act on a proposal from the approval queue.
 *   - approve:    if the proposal carries a draft, post it to the ticket as a
 *                 reply, then mark it sent.
 *   - mark-sent:  mark sent WITHOUT posting (reply already sent elsewhere).
 *   - dismiss:    mark dismissed.
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

    if (action === 'approve') {
      const proposal: HermesProposal =
        typeof rec.proposal === 'string'
          ? JSON.parse(rec.proposal)
          : rec.proposal;
      if (proposal?.draft && rec.ref) {
        await addTicketComment(rec.ref, proposal.draft, by, 'reply');
      }
      await q(
        `update ops.hermes_proposals
            set status = 'sent', decided_at = now(), decided_by = $2
          where id = $1`,
        [id, by],
      );
      return { ok: true };
    }

    if (action === 'mark-sent') {
      await q(
        `update ops.hermes_proposals
            set status = 'sent', decided_at = now(), decided_by = $2
          where id = $1`,
        [id, by],
      );
      return { ok: true };
    }

    // dismiss
    await q(
      `update ops.hermes_proposals
          set status = 'dismissed', decided_at = now(), decided_by = $2
        where id = $1`,
      [id, by],
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'failed to act on proposal' };
  }
}
