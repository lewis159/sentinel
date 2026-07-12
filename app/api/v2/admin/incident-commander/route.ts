// Hermes · Incident Commander API (section-gated: 'hermes').
//
//   GET  — active incidents (open incident tickets + alert-only candidates) each
//          with their assembled context (firing alerts, recent deploys, related
//          tickets, monitoring state, timeline). Read-only. Mock-safe.
//   POST — three operator actions:
//            { action:'open-incident', from:{...} }   → createTicket(kind:'incident')
//                                                        (operator action, additive)
//            { action:'draft-status',  incident:{...}}→ assemble + draft + QUEUE a
//                                                        proposal (kind:'incident-status').
//                                                        NEVER broadcasts.
//            { action:'approve-broadcast', proposalId, text }
//                                                      → GATED broadcast, then mark sent.
//
// The only external side effect (a status broadcast) is behind the explicit
// approve-broadcast action. Opening an incident ticket is an additive operator
// action. Nothing here auto-posts.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import {
  getActiveIncidents,
  assembleIncidentContext,
  primaryService,
  type ActiveIncident,
} from '@/lib/incident/context';
import {
  draftIncidentStatus,
  queueStatusProposal,
  approveStatusBroadcast,
} from '@/lib/incident/status-draft';
import { createTicket } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  try {
    const incidents = await getActiveIncidents();
    const withContext = await Promise.all(
      incidents.map(async (incident) => ({
        incident,
        context: await assembleIncidentContext(incident),
      })),
    );
    return NextResponse.json({ ok: true, brainEnabled: brainEnabled(), incidents: withContext });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'failed to assemble incidents' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const action = body?.action;
  const { userId } = await getSessionAccess();
  const by = userId ?? 'operator';

  try {
    // ---- Open a new incident ticket from an alert/candidate (operator action) ----
    if (action === 'open-incident') {
      const from = body?.from ?? {};
      const title: string = String(from.title ?? 'New incident').slice(0, 200);
      const sev = String(from.severity ?? from.priority ?? 'high');
      const priority = sev === 'critical' ? 'critical' : sev === 'warning' ? 'high' : (sev as any);
      const { ref } = await createTicket({
        kind: 'incident',
        title,
        description: from.description ?? `Opened from Incident Commander (${from.service ?? 'estate'}).`,
        app: from.app ?? 'Estate',
        impact: 'high',
        urgency: 'high',
        priority: (priority === 'critical' || priority === 'high' ? priority : 'high') as any,
        source: 'alert',
      });

      // Assemble the context for the freshly-opened incident so the UI can render it.
      const incident: ActiveIncident = {
        ref,
        title,
        status: 'open',
        priority: priority === 'critical' ? 'critical' : 'high',
        app: from.app ?? 'Estate',
        service: from.service ?? primaryService(title),
        source: 'ticket',
      };
      const context = await assembleIncidentContext(incident);
      return NextResponse.json({ ok: true, ref, incident, context });
    }

    // ---- Draft a status update and QUEUE it as a proposal (no broadcast) ----
    if (action === 'draft-status') {
      const inc = body?.incident;
      if (!inc || typeof inc.title !== 'string') {
        return NextResponse.json({ ok: false, error: 'incident is required' }, { status: 400 });
      }
      const incident: ActiveIncident = {
        ref: inc.ref ?? null,
        title: inc.title,
        status: inc.status ?? 'open',
        priority: inc.priority ?? 'high',
        app: inc.app ?? 'Estate',
        service: inc.service ?? primaryService(inc.title),
        source: inc.source === 'alert' ? 'alert' : 'ticket',
        severity: inc.severity,
      };
      const context = await assembleIncidentContext(incident);
      const draft = await draftIncidentStatus(context);
      const queue = body?.queue !== false; // default: queue it
      let proposalId: string | null = null;
      if (queue) {
        ({ proposalId } = await queueStatusProposal({ incidentRef: incident.ref, draft, context, by }));
      }
      return NextResponse.json({ ok: true, draft, proposalId, queued: queue && proposalId !== null });
    }

    // ---- Approve → GATED broadcast, then mark the proposal sent ----
    if (action === 'approve-broadcast') {
      const proposalId = String(body?.proposalId ?? '');
      const text = String(body?.text ?? '');
      if (!proposalId || !text) {
        return NextResponse.json({ ok: false, error: 'proposalId and text are required' }, { status: 400 });
      }
      const res = await approveStatusBroadcast({ proposalId, text, by });
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
      return NextResponse.json({ ok: true, via: res.via });
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'action failed' }, { status: 500 });
  }
}
