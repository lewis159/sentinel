// Hermes · Support — thin wrapper. The Support copilot now lives on the shared
// Brain as the `support` persona (lib/hermes/brain/personas/copilots.ts) and runs
// via runCopilotProposal. This module keeps the original draftSupportReply()
// signature so existing callers (triage routes, auto-triage, tests) keep working.
import 'server-only';
import { runCopilotProposal } from './brain/copilot';
import type { HermesProposal } from './types';

export async function draftSupportReply(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  return runCopilotProposal({ persona: 'support', input });
}
