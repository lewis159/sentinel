import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServiceTicket } from '@/lib/mock';

// --- Mock the data + model modules the service lazy-imports ----------------
const getTicketsByKind = vi.fn();
const callModel = vi.fn();

vi.mock('@/lib/data', () => ({
  getTicketsByKind: (...args: any[]) => getTicketsByKind(...args),
}));
vi.mock('@/lib/hermes/brain/model', () => ({
  callModel: (...args: any[]) => callModel(...args),
}));

function ticket(partial: Partial<ServiceTicket> & { ref: string; title: string }): ServiceTicket {
  return {
    kind: 'request',
    description: '',
    status: 'open',
    priority: 'low',
    impact: 'low',
    urgency: 'low',
    app: 'YT',
    assignee: '—',
    source: 'manual',
    slaDue: null,
    age: '1d',
    tenantRef: null,
    customerEmail: null,
    customerName: null,
    attrs: {},
    ...partial,
  };
}

const REQUESTS: ServiceTicket[] = [
  ticket({ ref: 'REQ-1', title: 'Add PDF export for transcripts', description: 'export to pdf', age: '2h' }),
  ticket({ ref: 'REQ-2', title: 'Export transcript to PDF', description: 'pdf export please', age: '1d' }),
  ticket({ ref: 'REQ-3', title: 'SSO login for enterprise', description: 'okta sso login', age: '3h' }),
  ticket({ ref: 'REQ-4', title: 'Enterprise SSO login support', description: 'sso login', age: '2d' }),
];

// One incident flagged as product feedback → should be picked up as a candidate.
const INCIDENTS: ServiceTicket[] = [
  ticket({ ref: 'INC-1', kind: 'incident', title: 'PDF export is missing', description: 'want pdf export', source: 'feedback', age: '5h' }),
  ticket({ ref: 'INC-2', kind: 'incident', title: 'Queue stalled', description: 'ops incident', source: 'alert', age: '1h' }),
];

beforeEach(() => {
  getTicketsByKind.mockReset();
  callModel.mockReset();
  getTicketsByKind.mockImplementation(async (kind: string) => {
    if (kind === 'request') return { rows: REQUESTS, live: true };
    if (kind === 'incident') return { rows: INCIDENTS, live: true };
    return { rows: [], live: false };
  });
});

afterEach(() => {
  delete process.env.HERMES_BRAIN_ENABLED;
  vi.resetModules();
});

async function loadService() {
  // Fresh import each time so brainEnabled() re-reads the env.
  vi.resetModules();
  return import('@/lib/feature-requests/service');
}

describe('getFeatureRequestClusters — brain OFF (dormant)', () => {
  it('uses deterministic labels and never calls the model', async () => {
    delete process.env.HERMES_BRAIN_ENABLED;
    const { getFeatureRequestClusters } = await loadService();

    const result = await getFeatureRequestClusters();

    expect(result.labelSource).toBe('deterministic');
    expect(result.brainRefined).toBe(false);
    expect(result.live).toBe(true);
    expect(result.clusters.length).toBeGreaterThan(0);
    // The model must NOT be consulted when the Brain is off.
    expect(callModel).not.toHaveBeenCalled();
    // No cluster carries Brain-only fields.
    expect(result.clusters.every((c) => !c.refined && !c.suggestedRoadmapTitle)).toBe(true);
  });

  it('picks up the feedback-flagged incident as a candidate (and dedupes by ref)', async () => {
    const { getFeatureRequestClusters } = await loadService();
    const result = await getFeatureRequestClusters();
    // 4 requests + 1 feedback incident (INC-2 is not feedback → excluded).
    expect(result.candidateCount).toBe(5);
    const allRefs = result.clusters.flatMap((c) => c.examples.map((e) => e.ref));
    expect(allRefs).toContain('INC-1');
    expect(allRefs).not.toContain('INC-2');
    // The feedback incident joins the PDF-export theme and is tagged 'feedback'.
    const exportTheme = result.clusters.find((c) => c.examples.some((e) => e.ref === 'INC-1'));
    expect(exportTheme?.examples.find((e) => e.ref === 'INC-1')?.source).toBe('feedback');
  });
});

describe('getFeatureRequestClusters — brain ON (refinement)', () => {
  it('applies model labels/summaries/roadmap titles as a draft', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    callModel.mockResolvedValue({
      ok: true,
      model: 'test-model',
      content: JSON.stringify([
        { index: 0, label: 'PDF Export', summary: 'Users want PDF export.', suggestedRoadmapTitle: 'Ship PDF export' },
        { index: 1, label: 'Enterprise SSO', summary: 'Enterprises want SSO.', suggestedRoadmapTitle: 'Add SSO login' },
      ]),
    });

    const { getFeatureRequestClusters } = await loadService();
    const result = await getFeatureRequestClusters();

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.labelSource).toBe('refined');
    expect(result.brainRefined).toBe(true);
    const labels = result.clusters.map((c) => c.label);
    expect(labels).toContain('PDF Export');
    expect(result.clusters.some((c) => c.suggestedRoadmapTitle === 'Ship PDF export')).toBe(true);
    expect(result.clusters.every((c) => c.refined)).toBe(true);
  });

  it('falls back to deterministic labels when the model errors', async () => {
    process.env.HERMES_BRAIN_ENABLED = 'true';
    callModel.mockResolvedValue({ ok: false, error: 'boom' });

    const { getFeatureRequestClusters } = await loadService();
    const result = await getFeatureRequestClusters();

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.labelSource).toBe('deterministic');
    expect(result.brainRefined).toBe(false);
    expect(result.clusters.every((c) => !c.suggestedRoadmapTitle)).toBe(true);
  });
});
