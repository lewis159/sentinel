import { describe, it, expect, vi } from 'vitest';

// Verifies the two remaining EXEC personas that complete the roster —
// CEO / Chief-of-Staff and Risk / Red-team:
//   • both register in the Brain persona registry and resolve via getPersona,
//   • CEO carries only read-only estate tools (no side-effect lever),
//   • Risk is ADVISORY-ONLY: its tool set can NEVER produce a side effect
//     (no gated tool, and a strict subset of the read-only tools), and
//   • both appear in the client-safe EXEC_ROSTER metadata with valid RBAC
//     sections.
//
// The Brain tool registry imports 'server-only' + '@/lib/data'; stub them so we
// can pull the REAL tool autonomy values without a DB or a server runtime.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({
  getServiceTicket: vi.fn(),
  getTicketsByKind: vi.fn(),
  updateTicket: vi.fn(),
  addTicketComment: vi.fn(),
}));

import { getPersona, autonomyFor } from '@/lib/hermes/brain/personas';
import { getTool, ALL_TOOLS } from '@/lib/hermes/brain/tools';
import { EXEC_ROSTER } from '@/lib/hermes/agent-meta';

// The only tools that can change the world: updateTicket (gated, mutates a ticket)
// and broadcastStatus (auto, but posts to a channel — a side effect). Everything
// else in the registry is a pure read. Derived from the real registry so this
// stays honest if the tool set grows.
const READ_ONLY = new Set([
  'getTicket',
  'listTickets',
  'getDeployStatus',
  // read-only lookups added by the P3 action tools
  'getCharge',
  'getFileContents',
  'listWorkflowRuns',
]);
const SIDE_EFFECTING = ALL_TOOLS.filter((t) => !READ_ONLY.has(t.name)).map((t) => t.name);
// The known world-changing levers. Kept as a containment check (not equality) so
// adding a new gated tool doesn't break this — it only must never be a pure read.
const KNOWN_WRITE_TOOLS = [
  'updateTicket',
  'broadcastStatus',
  'refundCharge',
  'issueCredit',
  'sendEmail',
  'triggerWorkflow',
  'commitFile',
];

describe('exec roster personas (CEO + Risk)', () => {
  it('sanity: the registry classifies the known write tools as side-effecting, and no read tool as such', () => {
    for (const w of KNOWN_WRITE_TOOLS) {
      if (ALL_TOOLS.some((t) => t.name === w)) expect(SIDE_EFFECTING).toContain(w);
    }
    for (const r of READ_ONLY) expect(SIDE_EFFECTING).not.toContain(r);
  });

  describe('CEO / Chief-of-Staff', () => {
    it('registers and resolves', () => {
      const ceo = getPersona('ceo');
      expect(ceo).toBeDefined();
      expect(ceo!.id).toBe('ceo');
      expect(ceo!.systemPrompt).toMatch(/Chief-of-Staff/);
    });

    it('holds only read-only tools — no side-effecting lever', () => {
      const ceo = getPersona('ceo')!;
      expect(ceo.allowedTools).not.toBe('*');
      const tools = ceo.allowedTools as string[];
      expect(tools.length).toBeGreaterThan(0);
      for (const name of tools) {
        expect(READ_ONLY.has(name)).toBe(true);
        expect(SIDE_EFFECTING).not.toContain(name);
      }
    });

    it('has no gated autonomy override', () => {
      const ceo = getPersona('ceo')!;
      expect(ceo.autonomyByTool ?? {}).toEqual({});
    });
  });

  describe('Risk / Red-team (advisory-only)', () => {
    it('registers and resolves and is flagged advisory', () => {
      const risk = getPersona('risk');
      expect(risk).toBeDefined();
      expect(risk!.id).toBe('risk');
      expect(risk!.advisory).toBe(true);
      expect(risk!.systemPrompt).toMatch(/advisory-only/i);
    });

    it('has an EMPTY executable-tool set — cannot produce any side effect', () => {
      const risk = getPersona('risk')!;
      expect(risk.allowedTools).not.toBe('*');
      const tools = risk.allowedTools as string[];

      // 1) No side-effecting tool is present at all.
      for (const name of SIDE_EFFECTING) {
        expect(tools).not.toContain(name);
      }
      // 2) Every tool it DOES hold is a real, read-only registry tool that
      //    resolves to 'auto' autonomy — never 'gated'. So there is no tool the
      //    graph could offer that would interrupt-then-mutate.
      for (const name of tools) {
        expect(READ_ONLY.has(name)).toBe(true);
        const tool = getTool(name);
        expect(tool).toBeDefined();
        expect(tool!.autonomy).toBe('auto');
        expect(autonomyFor(risk, name, tool!.autonomy)).toBe('auto');
      }
    });
  });

  describe('EXEC_ROSTER metadata', () => {
    const VALID_SECTIONS = new Set(['support', 'operations', 'security']);

    for (const id of ['ceo', 'risk'] as const) {
      it(`${id} has valid roster metadata mapped to an existing RBAC section`, () => {
        const meta = EXEC_ROSTER[id];
        expect(meta).toBeDefined();
        expect(meta.id).toBe(id);
        expect(meta.label.trim().length).toBeGreaterThan(0);
        expect(meta.description.trim().length).toBeGreaterThan(0);
        expect(VALID_SECTIONS.has(meta.section)).toBe(true);
      });
    }

    it('maps CEO→operations and Risk→security (advisory)', () => {
      expect(EXEC_ROSTER.ceo.section).toBe('operations');
      expect(EXEC_ROSTER.risk.section).toBe('security');
      expect(EXEC_ROSTER.risk.advisory).toBe(true);
    });
  });
});
