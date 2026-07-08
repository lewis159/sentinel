import { describe, it, expect } from 'vitest';
import { AGENT_META, type AgentKey } from '@/lib/hermes/agent-meta';

const KEYS: AgentKey[] = ['support', 'incident', 'escalation', 'billing', 'security'];
const VALID_SECTIONS = new Set(['support', 'operations', 'security']);

describe('AGENT_META', () => {
  for (const key of KEYS) {
    describe(key, () => {
      const meta = AGENT_META[key];

      it('exists', () => {
        expect(meta).toBeDefined();
      });

      it('has non-empty header/button/action/tagline', () => {
        expect(meta.header.trim().length).toBeGreaterThan(0);
        expect(meta.button.trim().length).toBeGreaterThan(0);
        expect(meta.action.trim().length).toBeGreaterThan(0);
        expect(meta.tagline.trim().length).toBeGreaterThan(0);
      });

      it('has a valid section', () => {
        expect(VALID_SECTIONS.has(meta.section)).toBe(true);
      });

      it('has a non-empty commentKind', () => {
        expect(meta.commentKind.trim().length).toBeGreaterThan(0);
      });
    });
  }
});
