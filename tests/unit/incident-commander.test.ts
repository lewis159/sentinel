import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hermes · Incident Commander unit tests. We NEVER hit real monitoring, DB, or
// the model:
//   • the monitoring clients (@/lib/alertmanager, @/lib/uptime), the deploy tool,
//     and @/lib/data.getTicketsByKind are mocked so we can drive correlation;
//   • @/lib/hermes/brain/flags.brainEnabled, @/lib/hermes/proposals.saveProposal,
//     the broadcast tool and @/lib/hermes/openrouter.chat are mocked so we can
//     prove: brain-off → deterministic template (NO model call), and draft →
//     an `incident-status` proposal with NO broadcast.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => ({
  getActiveAlerts: vi.fn(),
  getUptimeStatus: vi.fn(),
  deployRun: vi.fn(),
  getTicketsByKind: vi.fn(),
  brainEnabled: vi.fn(() => false),
  saveProposal: vi.fn(async () => 'prop-123'),
  actOnProposal: vi.fn(async () => ({ ok: true })),
  broadcastRun: vi.fn(async () => ({ ok: true, summary: 'sent', data: { via: 'log' } })),
  chat: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alertmanager', () => ({ getActiveAlerts: H.getActiveAlerts }));
vi.mock('@/lib/uptime', () => ({ getUptimeStatus: H.getUptimeStatus }));
vi.mock('@/lib/hermes/brain/tools/deploy', () => ({
  getDeployStatusTool: { name: 'getDeployStatus', run: H.deployRun },
}));
vi.mock('@/lib/data', () => ({ getTicketsByKind: H.getTicketsByKind, createTicket: vi.fn() }));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: H.brainEnabled }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal, actOnProposal: H.actOnProposal }));
vi.mock('@/lib/hermes/brain/tools/broadcast', () => ({
  broadcastStatusTool: { name: 'broadcastStatus', run: H.broadcastRun },
}));
vi.mock('@/lib/hermes/openrouter', () => ({ chat: H.chat }));

import {
  getActiveIncidents,
  assembleIncidentContext,
  extractServiceTokens,
} from '@/lib/incident/context';
import { draftIncidentStatus, queueStatusProposal } from '@/lib/incident/status-draft';

const groups = (over: Partial<Record<string, number>> = {}) => ({ critical: 0, warning: 0, info: 0, other: 0, ...over });

function ticket(over: Partial<any> = {}): any {
  return {
    ref: 'INC-9001', kind: 'incident', title: 'Transcription queue backed up', description: 'worker pool stalled',
    status: 'in_progress', priority: 'critical', impact: 'high', urgency: 'high', app: 'YT', assignee: 'ben',
    source: 'alert', slaDue: null, age: '2h', tenantRef: null, customerEmail: null, customerName: null, attrs: {},
    ...over,
  };
}

function sourced(rows: any[]) {
  return { rows, live: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.brainEnabled.mockReturnValue(false);
  H.saveProposal.mockResolvedValue('prop-123');
  H.broadcastRun.mockResolvedValue({ ok: true, summary: 'sent', data: { via: 'log' } });
  // Defaults: no alerts, no uptime, deploy not configured, no tickets.
  H.getActiveAlerts.mockResolvedValue({ ok: true, groups: groups(), alerts: [] });
  H.getUptimeStatus.mockResolvedValue({ ok: false, monitors: [], note: 'n/a' });
  H.deployRun.mockResolvedValue({ ok: false, summary: 'Deploy status not configured', error: 'not_configured' });
  H.getTicketsByKind.mockResolvedValue(sourced([]));
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

describe('service-token extraction', () => {
  it('pulls known service tokens from a blob and ignores substrings', () => {
    expect(extractServiceTokens('Transcription queue backed up', 'YT')).toEqual(
      expect.arrayContaining(['queue', 'transcription', 'yt']),
    );
    // 'api' must not fire inside 'capital'
    expect(extractServiceTokens('capital gains')).not.toContain('api');
  });
});

describe('assembleIncidentContext — correlates alerts ↔ tickets', () => {
  it('correlates a firing alert and a related ticket sharing a service token', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ critical: 1 }),
      alerts: [
        { name: 'QueueBacklog', severity: 'critical', summary: 'Transcription queue backed up', startsAt: '2026-07-12T10:00:00Z' },
        { name: 'UnrelatedDiskWarn', severity: 'warning', summary: 'Something on billing', startsAt: '2026-07-12T09:00:00Z' },
      ],
    });
    // incidents feed: self (INC-9001) + a related problem via kind=problem call.
    H.getTicketsByKind.mockImplementation(async (kind: string) => {
      if (kind === 'incident') return sourced([ticket()]);
      if (kind === 'problem') return sourced([ticket({ ref: 'PRB-9001', kind: 'problem', title: 'Recurring queue stalls under load', app: 'YT' })]);
      return sourced([]);
    });

    const incident = {
      ref: 'INC-9001', title: 'Transcription queue backed up', status: 'in_progress',
      priority: 'critical', app: 'YT', service: 'queue', source: 'ticket' as const,
    };
    const ctx = await assembleIncidentContext(incident);

    // The queue alert correlates; the billing alert does not.
    const queueAlert = ctx.alerts.find((a) => a.name === 'QueueBacklog');
    const billingAlert = ctx.alerts.find((a) => a.name === 'UnrelatedDiskWarn');
    expect(queueAlert?.correlated).toBe(true);
    expect(billingAlert?.correlated).toBe(false);

    // The related problem correlated on 'queue'; self (INC-9001) is excluded.
    const refs = ctx.relatedTickets.map((r) => r.ref);
    expect(refs).toContain('PRB-9001');
    expect(refs).not.toContain('INC-9001');
    expect(ctx.relatedTickets.find((r) => r.ref === 'PRB-9001')?.matchedOn).toContain('queue');

    // Timeline includes the correlated firing alert (timestamped first).
    expect(ctx.timeline[0].kind).toBe('alert');
    // Monitoring maps a firing critical → down.
    expect(ctx.monitoringState.overall).toBe('down');
  });

  it('getActiveIncidents synthesises a CANDIDATE from a firing alert with no matching ticket', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ critical: 1 }),
      alerts: [{ name: 'RedisDown', severity: 'critical', summary: 'redis primary down', startsAt: '' }],
    });
    H.getTicketsByKind.mockResolvedValue(sourced([])); // no open incidents

    const incidents = await getActiveIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].source).toBe('alert');
    expect(incidents[0].ref).toBeNull();
    expect(incidents[0].service).toBe('redis');
  });

  it('getActiveIncidents does NOT add a candidate when an open incident already covers the alert', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ critical: 1 }),
      alerts: [{ name: 'QueueBacklog', severity: 'critical', summary: 'queue backed up', startsAt: '' }],
    });
    H.getTicketsByKind.mockImplementation(async (kind: string) =>
      kind === 'incident' ? sourced([ticket()]) : sourced([]),
    );

    const incidents = await getActiveIncidents();
    // Only the open ticket — no alert candidate (it correlates to INC-9001).
    expect(incidents.every((i) => i.source === 'ticket')).toBe(true);
    expect(incidents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Status draft — brain-off template (no model call)
// ---------------------------------------------------------------------------

async function ctxFor(overall: 'operational' | 'degraded' | 'down' = 'down') {
  H.getActiveAlerts.mockResolvedValue({
    ok: true,
    groups: overall === 'down' ? groups({ critical: 1 }) : overall === 'degraded' ? groups({ warning: 1 }) : groups(),
    alerts: overall === 'operational' ? [] : [{ name: 'QueueBacklog', severity: overall === 'down' ? 'critical' : 'warning', summary: 'queue backed up', startsAt: '' }],
  });
  return assembleIncidentContext({
    ref: 'INC-9001', title: 'Transcription queue backed up', status: 'in_progress',
    priority: 'critical', app: 'YT', service: 'queue', source: 'ticket',
  });
}

describe('draftIncidentStatus — brain OFF → deterministic template, no model call', () => {
  it('produces a template draft and NEVER calls the model', async () => {
    H.brainEnabled.mockReturnValue(false);
    const ctx = await ctxFor('down');
    const draft = await draftIncidentStatus(ctx);

    expect(draft.generatedBy).toBe('template');
    expect(draft.text).toContain('Affected:');
    expect(draft.text).toContain('Impact:');
    expect(draft.text).toContain("What we're doing:");
    expect(draft.text).toContain('ETA:');
    // The model client was never consulted.
    expect(H.chat).not.toHaveBeenCalled();
  });

  it('maps a down monitoring state to an unavailable impact line', async () => {
    const ctx = await ctxFor('down');
    const draft = await draftIncidentStatus(ctx);
    expect(draft.impact.toLowerCase()).toContain('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Gating — draft → incident-status proposal, NO broadcast
// ---------------------------------------------------------------------------

describe('queueStatusProposal — saves an incident-status proposal and does NOT broadcast', () => {
  it('persists via saveProposal(kind:incident-status) and never calls broadcast', async () => {
    const ctx = await ctxFor('down');
    const draft = await draftIncidentStatus(ctx);

    const { proposalId } = await queueStatusProposal({ incidentRef: 'INC-9001', draft, context: ctx });

    expect(proposalId).toBe('prop-123');
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = H.saveProposal.mock.calls[0][0];
    expect(arg.kind).toBe('incident-status');
    expect(arg.agent).toBe('incident-commander');
    expect(arg.ref).toBe('INC-9001');
    expect(arg.proposal.draft).toBe(draft.text);
    // Crucially — queuing NEVER broadcasts.
    expect(H.broadcastRun).not.toHaveBeenCalled();
  });
});
