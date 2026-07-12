// Hermes · Escalations — thin wrapper. The Escalations copilot now lives on the
// shared Brain as the `escalation` persona and runs via runCopilotProposal. This
// module keeps the original draftEscalation() signature so existing callers keep
// working.
import 'server-only';
import { runCopilotProposal } from './brain/copilot';
import type { HermesProposal } from './types';

export async function draftEscalation(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  return runCopilotProposal({ persona: 'escalation', input });
}
