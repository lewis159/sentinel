// Hermes · Security — thin wrapper. The Security copilot now lives on the shared
// Brain as the `security` persona and runs via runCopilotProposal. This module
// keeps the original assessSecurity() signature so existing callers keep working.
import 'server-only';
import { runCopilotProposal } from './brain/copilot';
import type { HermesProposal } from './types';

export async function assessSecurity(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  return runCopilotProposal({ persona: 'security', input });
}
