import { describe, it, expect, vi, beforeEach } from 'vitest';

// Proves the P2 wiring: a DEPARTMENT COPILOT run agentically on the SHARED Brain
// graph behaves exactly like the PA on the action-execution spine —
//   • a GATED tool (Support · updateTicket) INTERRUPTS the graph and yields a
//     pending_approval marker WITHOUT executing the tool (→ the route raises an
//     action proposal in the Approvals queue), and
//   • an AUTO tool (a read) executes inline and finishes with NO pending approval
//     (→ no action proposal is raised).
//
// We drive the real graph (lib/hermes/brain/graph.ts) with a mocked model +
// in-memory checkpointer, mocking DB/model as the existing unit tests do.

import { MemorySaver } from '@langchain/langgraph';

// The Brain agentic path is flag-gated; turn it on for this suite.
process.env.HERMES_BRAIN_ENABLED = '1';

// Shared mutable state + spies, hoisted so the (hoisted) vi.mock factories below
// can safely reference them.
const h = vi.hoisted(() => {
  const modelQueue: { current: any[] } = { current: [] };
  const callModel = vi.fn(async () =>
    modelQueue.current.shift() ?? { ok: true, content: 'done', toolCalls: [], model: 'mock' },
  );
  const getServiceTicket = vi.fn(async (ref: string) => ({
    row: {
      ref,
      kind: 'incident',
      title: 'Disk full',
      description: 'node3 at 98%',
      status: 'open',
      priority: 'high',
      assignee: 'unassigned',
      app: 'sentinel',
      slaDue: null,
    },
    live: false,
  }));
  const dataUpdateTicket = vi.fn(async () => ({ row: null, live: false }));
  const addTicketComment = vi.fn(async () => {});
  const getTicketsByKind = vi.fn(async () => ({ rows: [], live: false }));
  return { modelQueue, callModel, getServiceTicket, dataUpdateTicket, addTicketComment, getTicketsByKind };
});

vi.mock('server-only', () => ({}));

// No DB → resolveAutonomy() falls back to the persona/tool static default (so the
// dial resolution is exercised purely from code, matching a fresh environment).
vi.mock('@/lib/db', () => ({
  get hasDb() {
    return false;
  },
  q: vi.fn(async () => []),
}));

// KB retrieval is irrelevant to the agentic path; stub it so importing copilot.ts
// never reaches embeddings/config.
vi.mock('@/lib/hermes/kb-context', () => ({
  retrieveKb: vi.fn(async () => []),
}));

// In-memory checkpointer gives the graph the pause/resume the interrupt needs.
vi.mock('@/lib/hermes/brain/checkpointer', () => ({
  getCheckpointer: vi.fn(async () => new MemorySaver()),
}));

// Sequential fake model: each agent turn shifts the next canned reply.
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: h.callModel }));

// The only tool that actually executes in these tests is the AUTO read (getTicket
// → getServiceTicket). updateTicket must NOT run (it interrupts first) — we assert
// on these spies to prove no side effect happened before approval.
vi.mock('@/lib/data', () => ({
  getServiceTicket: h.getServiceTicket,
  updateTicket: h.dataUpdateTicket,
  addTicketComment: h.addTicketComment,
  getTicketsByKind: h.getTicketsByKind,
}));

const { callModel, getServiceTicket, dataUpdateTicket, addTicketComment } = h;

import { runCopilotAction } from '@/lib/hermes/brain/copilot';

beforeEach(() => {
  h.modelQueue.current = [];
  callModel.mockClear();
  getServiceTicket.mockClear();
  dataUpdateTicket.mockClear();
  addTicketComment.mockClear();
});

describe('copilot agentic actions on the shared spine', () => {
  it('a GATED tool (Support · updateTicket) yields a PENDING approval and does NOT execute', async () => {
    // The model asks to mutate a ticket — a gated action for the support copilot.
    h.modelQueue.current = [
      {
        ok: true,
        content: '',
        toolCalls: [
          { id: 'call_g1', name: 'updateTicket', args: { ref: 'INC-0001', status: 'resolved' } },
        ],
        model: 'mock',
      },
    ];

    const res = await runCopilotAction({
      persona: 'support',
      threadId: 'test:gated-1',
      message: 'Please resolve INC-0001.',
    });

    // Interrupts → pending approval (the route would now raise an action proposal).
    expect(res.status).toBe('pending_approval');
    if (res.status === 'pending_approval') {
      expect(res.pending.tool).toBe('updateTicket');
      expect(res.pending.args).toMatchObject({ ref: 'INC-0001', status: 'resolved' });
    }
    // Crucially, the mutation did NOT run before approval.
    expect(dataUpdateTicket).not.toHaveBeenCalled();
    expect(addTicketComment).not.toHaveBeenCalled();
    // Model ran exactly one agent turn (paused before a second).
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it('an AUTO tool (a read) executes inline and raises NO pending approval', async () => {
    // First turn: call the read tool. Second turn: the model answers, ending cleanly.
    h.modelQueue.current = [
      {
        ok: true,
        content: '',
        toolCalls: [{ id: 'call_a1', name: 'getTicket', args: { ref: 'INC-0002' } }],
        model: 'mock',
      },
      { ok: true, content: 'INC-0002 is open (high).', toolCalls: [], model: 'mock' },
    ];

    const res = await runCopilotAction({
      persona: 'billing',
      threadId: 'test:auto-1',
      message: 'What is the status of INC-0002?',
    });

    // No interrupt → answered, so the route would NOT persist an action proposal.
    expect(res.status).toBe('answered');
    if (res.status === 'answered') {
      expect(res.reply).toContain('INC-0002');
    }
    // The auto read executed for real; no gated mutation happened.
    expect(getServiceTicket).toHaveBeenCalledWith('INC-0002');
    expect(dataUpdateTicket).not.toHaveBeenCalled();
  });
});
