// Hermes · Billing (CFO) — thin wrapper. The Billing copilot now lives on the
// shared Brain as the `billing` persona and runs via runCopilotProposal. This
// module keeps the original assessBilling() signature so existing callers keep
// working. Money still always needs a human — the persona never executes.
import 'server-only';
import { runCopilotProposal } from './brain/copilot';
import type { HermesProposal } from './types';

export async function assessBilling(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  return runCopilotProposal({ persona: 'billing', input });
}
