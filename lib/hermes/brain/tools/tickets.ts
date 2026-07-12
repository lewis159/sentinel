// Ticket tools for the Brain — thin wrappers over lib/data.ts so the Brain reuses
// the exact same persistence the web console and Discord bot already use.
//
//   getTicket   (auto)  — read one ITIL ticket by ref.
//   listTickets (auto)  — list tickets, optionally filtered by kind.
//   updateTicket (GATED) — the P0 demo side-effect: change status / assignee /
//                          add a comment. Gated → raises a proposal → executes
//                          only on human Approve.
import 'server-only';
import { z } from 'zod';
import {
  getServiceTicket,
  getTicketsByKind,
  updateTicket as dataUpdateTicket,
  addTicketComment,
} from '@/lib/data';
import type { TicketKind } from '@/lib/mock';
import type { BrainTool } from './types';

const TICKET_KINDS = ['incident', 'request', 'change', 'problem', 'release'] as const;

// ---------- getTicket (auto / read) ----------
const getTicketSchema = z.object({
  ref: z.string().describe('The ticket ref, e.g. INC-0001 / REQ-0002 / CHG-0001.'),
});

export const getTicketTool: BrainTool<z.infer<typeof getTicketSchema>> = {
  name: 'getTicket',
  description:
    'Read a single service (ITIL) ticket by its ref. Returns title, status, priority, assignee and description. Use before answering questions about a specific ticket.',
  schema: getTicketSchema,
  autonomy: 'auto',
  run: async ({ ref }) => {
    const { row } = await getServiceTicket(ref);
    if (!row) return { ok: false, summary: `No ticket found for ${ref}.`, error: 'not_found' };
    return {
      ok: true,
      summary: `${row.ref} · ${row.title} — status ${row.status}, priority ${row.priority}, assignee ${row.assignee}.`,
      data: {
        ref: row.ref,
        kind: row.kind,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assignee: row.assignee,
        app: row.app,
        slaDue: row.slaDue,
      },
    };
  },
};

// ---------- listTickets (auto / read) ----------
const listTicketsSchema = z.object({
  kind: z
    .enum(TICKET_KINDS)
    .optional()
    .describe('Filter by ITIL kind. Omit to default to incidents.'),
  limit: z.number().int().min(1).max(25).optional().describe('Max rows (default 10).'),
});

export const listTicketsTool: BrainTool<z.infer<typeof listTicketsSchema>> = {
  name: 'listTickets',
  description:
    'List recent service tickets, optionally filtered by kind (incident|request|change|problem|release). Use to answer "what incidents are open" style questions.',
  schema: listTicketsSchema,
  autonomy: 'auto',
  run: async ({ kind, limit }) => {
    const useKind: TicketKind = (kind ?? 'incident') as TicketKind;
    const max = limit ?? 10;
    const { rows } = await getTicketsByKind(useKind);
    const sliced = rows.slice(0, max);
    if (sliced.length === 0)
      return { ok: true, summary: `No ${useKind} tickets found.`, data: [] };
    const lines = sliced
      .map((t) => `${t.ref} · ${t.title} — ${t.status} (${t.priority})`)
      .join('\n');
    return {
      ok: true,
      summary: `${sliced.length} ${useKind} ticket(s):\n${lines}`,
      data: sliced.map((t) => ({
        ref: t.ref,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
      })),
    };
  },
};

// ---------- updateTicket (GATED / the P0 demo side-effect) ----------
const updateTicketSchema = z.object({
  ref: z.string().describe('The ticket ref to update, e.g. INC-0001.'),
  status: z.string().optional().describe('New workflow status, e.g. in_progress / resolved.'),
  assignee: z.string().optional().describe('New assignee label.'),
  comment: z.string().optional().describe('An update/comment to append to the ticket timeline.'),
});
export type UpdateTicketArgs = z.infer<typeof updateTicketSchema>;

export const updateTicketTool: BrainTool<UpdateTicketArgs> = {
  name: 'updateTicket',
  description:
    'Change a ticket: set its status and/or assignee and/or append a comment. This MUTATES the ticket, so it requires human approval before it runs.',
  schema: updateTicketSchema,
  autonomy: 'gated',
  describeCall: (a) => {
    const parts: string[] = [];
    if (a.status) parts.push(`status → ${a.status}`);
    if (a.assignee) parts.push(`assignee → ${a.assignee}`);
    if (a.comment) parts.push(`comment: "${a.comment.slice(0, 80)}"`);
    return `Update ${a.ref}: ${parts.join(', ') || '(no changes)'}`;
  },
  run: async ({ ref, status, assignee, comment }, ctx) => {
    const changed: string[] = [];
    if (status !== undefined || assignee !== undefined) {
      const { row } = await dataUpdateTicket(ref, { status, assignee });
      if (!row) return { ok: false, summary: `Ticket ${ref} not found.`, error: 'not_found' };
      if (status !== undefined) changed.push(`status=${status}`);
      if (assignee !== undefined) changed.push(`assignee=${assignee}`);
    }
    if (comment !== undefined && comment.trim()) {
      await addTicketComment(ref, comment, ctx.actor, 'update');
      changed.push('comment added');
    }
    return {
      ok: true,
      summary: `Updated ${ref}: ${changed.join(', ') || 'no fields changed'}.`,
      data: { ref, changed },
    };
  },
};
