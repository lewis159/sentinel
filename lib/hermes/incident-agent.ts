// Hermes · Incident response — thin wrapper. The Incident copilot now lives on
// the shared Brain as the `incident` persona and runs via runCopilotProposal.
// This module keeps the original assessIncident() signature so existing callers
// (auto-triage, triage routes) keep working.
import 'server-only';
import { runCopilotProposal } from './brain/copilot';
import type { HermesProposal } from './types';

export async function assessIncident(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  return runCopilotProposal({ persona: 'incident', input });
}
