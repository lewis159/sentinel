import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Runtime-flag wiring for the BRAIN gate (fix/runtime-flag-wiring).
//
// Proves the gap this change closes: the brain gate now resolves
// HERMES_BRAIN_ENABLED through the RUNTIME store (DB override → env default),
// NOT the raw env var — so a toggle from the Integrations page takes effect with
// no redeploy. We assert the DB override WINS over the env in BOTH directions:
//
//   • override OFF while env=1  → answerKnowledgeQuestion is disabled (no retrieval,
//     no model call). Previously the raw env=1 would have kept the brain live.
//   • override ON while env unset → the brain proceeds (retrieves + calls the model).
//
// We mock the runtime resolver (so no DB) + the model/KB/data reads, mirroring
// knowledge-qa.test.ts. This exercises the real answerKnowledgeQuestion gate.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const override = { value: false };
  const brainEnabledRuntime = vi.fn(async () => override.value);
  const callModel = vi.fn(async () => ({
    ok: true as const,
    content: JSON.stringify({ answer: 'Grounded.', sources: ['kb-slug'] }),
    toolCalls: [],
    model: 'mock-model',
  }));
  const retrieveKb = vi.fn(async () => [
    { slug: 'kb-slug', title: 'A KB doc', body: 'Some body text.' },
  ]);
  const getRecentTickets = vi.fn(async () => ({ rows: [], live: false }));
  const getRoadmap = vi.fn(async () => ({ rows: [], live: false }));
  return { override, brainEnabledRuntime, callModel, retrieveKb, getRecentTickets, getRoadmap };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/hermes/runtime-flags', () => ({ brainEnabledRuntime: h.brainEnabledRuntime }));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: h.callModel }));
vi.mock('@/lib/hermes/kb-context', () => ({ retrieveKb: h.retrieveKb }));
vi.mock('@/lib/data', () => ({ getRecentTickets: h.getRecentTickets, getRoadmap: h.getRoadmap }));

import { answerKnowledgeQuestion } from '@/lib/hermes/brain/knowledge';

beforeEach(() => {
  h.brainEnabledRuntime.mockClear();
  h.callModel.mockClear();
  h.retrieveKb.mockClear();
  h.getRecentTickets.mockClear();
  h.getRoadmap.mockClear();
});
afterEach(() => {
  delete process.env.HERMES_BRAIN_ENABLED;
});

describe('brain gate resolves via the runtime store', () => {
  it('DB override OFF beats env=1 → disabled, no retrieval / no model call', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1'; // env says ON …
    h.override.value = false; // … but the runtime override says OFF.

    const res = await answerKnowledgeQuestion('anything at all');

    expect(h.brainEnabledRuntime).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('disabled');
    expect(h.retrieveKb).not.toHaveBeenCalled();
    expect(h.callModel).not.toHaveBeenCalled();
  });

  it('DB override ON beats unset env → brain proceeds (retrieves + calls model)', async () => {
    delete process.env.HERMES_BRAIN_ENABLED; // env says OFF …
    h.override.value = true; // … but the runtime override says ON.

    const res = await answerKnowledgeQuestion('how do we recover a worker?');

    expect(h.brainEnabledRuntime).toHaveBeenCalledTimes(1);
    expect(h.retrieveKb).toHaveBeenCalledTimes(1);
    expect(h.callModel).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('answered');
  });
});
