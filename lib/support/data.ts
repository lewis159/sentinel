// Sentinel support desk — server-side data for staff roster, escalation ladder,
// and raising money/account actions to the human approval gate.
//
// Kept in its OWN module (not lib/data.ts) so the P3 build stays additive and
// off the shared ticket-data hotspot. It reuses two existing exports:
//   - addTicketComment  (lib/data.ts)  → audit note on the ticket timeline
//   - saveProposal      (lib/hermes/proposals.ts) → raise to the human gate
// No DB in dev (hasDb === false) → every function degrades to a safe fallback
// so the desk still renders.
import 'server-only';
import { hasDb, q, q1 } from '@/lib/db';
import { addTicketComment } from '@/lib/data';
import { saveProposal } from '@/lib/hermes/proposals';
import {
  type EscalationLevel,
  type SupportAction,
  ESCALATION_LADDER,
  LEVEL_LABEL,
  toEscalationLevel,
} from './roles';

export type SupportStaff = {
  clerkUserId: string;
  displayName: string;
  tier: 'agent' | 'lead';
  active: boolean;
};

export type TicketEscalation = {
  id: string;
  ticketRef: string;
  fromLevel: EscalationLevel | null;
  toLevel: EscalationLevel;
  reason: string | null;
  actor: string | null;
  createdAt: string;
};

// Belt-and-braces: create the P3 tables on the write path so prod doesn't
// hard-depend on migration 16 having run first (mirrors lib/hermes/proposals.ts).
async function ensureTables(): Promise<void> {
  await q(
    `create table if not exists ops.support_staff (
       clerk_user_id text primary key,
       display_name  text,
       tier          text not null default 'agent',
       active        boolean not null default true,
       created_at    timestamptz not null default now(),
       updated_at    timestamptz not null default now()
     )`,
  );
  await q(
    `create table if not exists ops.ticket_escalations (
       id          uuid primary key default gen_random_uuid(),
       ticket_ref  text not null,
       from_level  text,
       to_level    text not null,
       reason      text,
       actor       text,
       created_at  timestamptz not null default now()
     )`,
  );
}

// A sensible non-DB roster so the assign dropdown is never empty in dev.
const MOCK_STAFF: SupportStaff[] = [
  { clerkUserId: 'ben', displayName: 'Ben Percival', tier: 'lead', active: true },
  { clerkUserId: 'sam', displayName: 'Sam Okafor', tier: 'agent', active: true },
  { clerkUserId: 'maya', displayName: 'Maya Chen', tier: 'agent', active: true },
];

// The assignable staff roster (active only), leads first. DB-first, mock fallback.
export async function getSupportStaff(): Promise<SupportStaff[]> {
  if (!hasDb) return MOCK_STAFF;
  try {
    await ensureTables();
    const rows = await q<any>(
      `select clerk_user_id, display_name, tier, active
         from ops.support_staff
        where active
        order by (tier <> 'lead'), display_name`,
    );
    if (rows.length === 0) return MOCK_STAFF;
    return rows.map((r) => ({
      clerkUserId: r.clerk_user_id,
      displayName: r.display_name ?? r.clerk_user_id,
      tier: r.tier === 'lead' ? 'lead' : 'agent',
      active: r.active !== false,
    }));
  } catch {
    return MOCK_STAFF;
  }
}

// The tier a staff member sits at (used to route escalations to a person).
export async function getStaffTier(
  clerkUserId: string,
): Promise<'agent' | 'lead' | null> {
  if (!clerkUserId) return null;
  const staff = await getSupportStaff();
  const hit = staff.find((s) => s.clerkUserId === clerkUserId);
  return hit ? hit.tier : null;
}

// Priority ladder for the "bump on escalate" behaviour.
const PRIORITY_UP: Record<string, string> = {
  low: 'medium',
  medium: 'high',
  high: 'critical',
  critical: 'critical',
};

// Escalate a ticket to the next rung (or an explicit `toLevel`), recording who
// and why. Bumps priority one step, mirrors the current rung onto
// attrs.escalation_level (cheap reads), appends a timeline note, and writes an
// append-only ops.ticket_escalations row. Returns the new level + escalation id.
//
// This NEVER executes a refund/credit/account change — reaching the 'human'
// rung means the ticket now needs a human at the approval gate. For an actual
// money/account action use raiseHumanGateProposal (below), which routes to the
// existing proposals queue.
export async function escalateTicket(
  ref: string,
  toLevel: EscalationLevel | undefined,
  reason: string,
  actor: string,
): Promise<{ ok: boolean; level?: EscalationLevel; id?: string; error?: string }> {
  if (!hasDb) return { ok: false, error: 'no database in this environment' };
  try {
    await ensureTables();

    const row = await q1<any>(
      `select priority, attrs from ops.tickets where ref = $1`,
      [ref],
    );
    if (!row) return { ok: false, error: `ticket ${ref} not found` };

    const attrs =
      typeof row.attrs === 'string' ? safeJson(row.attrs) : row.attrs ?? {};
    const fromLevel = toEscalationLevel(attrs.escalation_level ?? 'l1');

    // Default: one rung up from wherever it is now. An explicit toLevel wins.
    const target =
      toLevel ??
      ESCALATION_LADDER[
        Math.min(
          ESCALATION_LADDER.indexOf(fromLevel) + 1,
          ESCALATION_LADDER.length - 1,
        )
      ];

    const nextPriority = PRIORITY_UP[row.priority ?? 'medium'] ?? row.priority;

    // Mirror the rung onto attrs + bump priority. Additive jsonb merge.
    await q(
      `update ops.tickets
          set priority = $2,
              attrs = coalesce(attrs, '{}'::jsonb)
                      || jsonb_build_object('escalation_level', $3::text),
              updated_at = now()
        where ref = $1`,
      [ref, nextPriority, target],
    );

    const esc = await q1<{ id: string }>(
      `insert into ops.ticket_escalations (ticket_ref, from_level, to_level, reason, actor)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [ref, fromLevel, target, reason || null, actor],
    );

    // Timeline note (best-effort — escalation still succeeds if this throws).
    try {
      await addTicketComment(
        ref,
        `Escalated to ${LEVEL_LABEL[target]}${reason ? ` — ${reason}` : ''}.`,
        actor,
        'update',
      );
    } catch {
      /* comment is best-effort */
    }

    return { ok: true, level: target, id: esc?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'escalation failed' };
  }
}

// The escalation history for a ticket, newest first.
export async function getTicketEscalations(
  ref: string,
): Promise<TicketEscalation[]> {
  if (!hasDb) return [];
  try {
    await ensureTables();
    const rows = await q<any>(
      `select id, ticket_ref, from_level, to_level, reason, actor, created_at
         from ops.ticket_escalations
        where ticket_ref = $1
        order by created_at desc`,
      [ref],
    );
    return rows.map((r) => ({
      id: r.id,
      ticketRef: r.ticket_ref,
      fromLevel: r.from_level ? toEscalationLevel(r.from_level) : null,
      toLevel: toEscalationLevel(r.to_level),
      reason: r.reason ?? null,
      actor: r.actor ?? null,
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at ?? ''),
    }));
  } catch {
    return [];
  }
}

// Raise a money/account action to the HUMAN approval gate — the existing Hermes
// proposals queue. This is the ONLY path a refund / credit / account change
// takes; nothing here executes it. The proposal carries `kind = action` (a
// PRIVILEGED_PROPOSAL_KIND) so the approve gate requires a global_admin. Returns
// the new proposal id (null with no DB).
export async function raiseHumanGateProposal(p: {
  ref: string;
  action: SupportAction; // 'refund' | 'credit' | 'account_change'
  title: string;
  summary: string;
  by: string;
}): Promise<string | null> {
  // Also record the escalation to the human rung for the audit trail.
  await escalateTicket(
    p.ref,
    'human',
    `${p.action} requires human approval — raised to the gate`,
    p.by,
  ).catch(() => undefined);

  return saveProposal({
    ref: p.ref,
    agent: 'support',
    kind: p.action, // privileged kind → approve gate demands global_admin
    title: p.title,
    summary: p.summary,
    proposal: {
      ok: true,
      configured: true,
      classification: `${p.action} · needs human approval`,
      reasoning:
        `A ${p.action} was requested on ${p.ref}. Money and account changes ` +
        `always require a human (global_admin) to approve here — no support ` +
        `role can execute this directly.`,
    },
  });
}

// Tickets flagged by P2 intake as needing a human (attrs.needs_human) OR already
// escalated to the human rung — the queue a lead/admin should watch. Additive
// read over attrs; never mutates.
export async function getTicketsNeedingHuman(
  limit = 50,
): Promise<{ ref: string; title: string; level: EscalationLevel }[]> {
  if (!hasDb) return [];
  try {
    const rows = await q<any>(
      `select ref, title, attrs
         from ops.tickets
        where coalesce((attrs->>'needs_human')::boolean, false) = true
           or attrs->>'escalation_level' = 'human'
        order by opened_at desc nulls last
        limit $1`,
      [limit],
    );
    return rows.map((r) => {
      const attrs =
        typeof r.attrs === 'string' ? safeJson(r.attrs) : r.attrs ?? {};
      return {
        ref: r.ref,
        title: r.title,
        level: toEscalationLevel(attrs.escalation_level ?? 'human'),
      };
    });
  } catch {
    return [];
  }
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
