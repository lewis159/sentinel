// Sentinel support desk — role → action authorization + escalation ladder.
//
// PURE module: no server-only imports, safe on client and server. Layers on top
// of the section-level RBAC in `@/lib/v2/rbac` (which already defines the
// support_agent / support_lead / global_admin roles and gates the `support`
// section). This module answers the finer question the desk needs: given a
// role, WHICH support actions may it take, and where do refunds / credits /
// account changes go?
//
// The golden rule: money + account changes (refund / credit / account_change)
// are NEVER executed by a support role directly. They ALWAYS route to the human
// approval gate — the existing Hermes proposals queue — where only a
// global_admin (Ben) can approve. No bypass. `authorize()` encodes this: those
// actions can at most return 'gate', never 'allow'.

export type SupportRole = 'support_agent' | 'support_lead' | 'global_admin';

// Front-line actions plus the privileged money/account actions.
export type SupportAction =
  | 'reply'
  | 'resolve'
  | 'assign'
  | 'escalate'
  | 'refund'
  | 'credit'
  | 'account_change';

// The escalation ladder, lowest → highest rung.
export type EscalationLevel = 'l1' | 'l2' | 'human';
export const ESCALATION_LADDER: EscalationLevel[] = ['l1', 'l2', 'human'];

export const LEVEL_LABEL: Record<EscalationLevel, string> = {
  l1: 'L1 · Front-line agent',
  l2: 'L2 · Support lead',
  human: 'Human approval gate',
};

// Which rung a role sits at / can act as.
export const ROLE_TIER: Record<string, EscalationLevel> = {
  support_agent: 'l1',
  support_lead: 'l2',
  global_admin: 'human',
};

// Actions that ALWAYS route to the human approval gate — no support role, not
// even a lead, executes these directly. Kept in sync with PRIVILEGED_PROPOSAL_KINDS
// (the `kind` a raised proposal carries) so the approve gate can require a
// global_admin for exactly these.
export const HUMAN_GATE_ACTIONS: SupportAction[] = [
  'refund',
  'credit',
  'account_change',
];

// Proposal `kind` values that must only be approvable by the human gate
// (global_admin). Mirrors HUMAN_GATE_ACTIONS.
export const PRIVILEGED_PROPOSAL_KINDS: string[] = [...HUMAN_GATE_ACTIONS];

export function requiresHumanGate(action: SupportAction): boolean {
  return HUMAN_GATE_ACTIONS.includes(action);
}

export function isPrivilegedProposalKind(kind: string | undefined | null): boolean {
  return typeof kind === 'string' && PRIVILEGED_PROPOSAL_KINDS.includes(kind);
}

// Authorization outcome for (role, action):
//   'allow' — perform it directly on the desk.
//   'gate'  — permitted only by RAISING a proposal to the human approval gate
//             (the existing proposals flow). No direct execution.
//   'deny'  — not permitted at all (cannot even initiate).
export type Authz = 'allow' | 'gate' | 'deny';

export function authorize(
  role: string | undefined,
  action: SupportAction,
): Authz {
  const isAdmin = role === 'global_admin';
  const isLead = role === 'support_lead';
  const isAgent = role === 'support_agent';

  if (requiresHumanGate(action)) {
    // Money / account changes: a lead or admin may RAISE them to the human gate;
    // an L1 agent cannot even initiate. Nobody self-approves here — 'gate' means
    // "goes to the proposals queue", never direct execution.
    return isAdmin || isLead ? 'gate' : 'deny';
  }

  // Front-line actions (reply / resolve / assign / escalate): any support role
  // may do them directly. global_admin included (superset).
  if (isAdmin || isLead || isAgent) return 'allow';
  return 'deny';
}

// Convenience: may `role` do `action` directly (no gate)?
export function canApprove(role: string | undefined, action: SupportAction): boolean {
  return authorize(role, action) === 'allow';
}

// Who may APPROVE a proposal at the human gate — the human (Ben / global_admin)
// only. This is what forces refunds/credits/account changes through Ben even
// after a lead has raised them.
export function canApproveAtGate(role: string | undefined): boolean {
  return role === 'global_admin';
}

// Next rung up the ladder from `level`, or null if already at the top (human).
export function nextEscalationLevel(
  level: EscalationLevel,
): EscalationLevel | null {
  const i = ESCALATION_LADDER.indexOf(level);
  if (i < 0 || i >= ESCALATION_LADDER.length - 1) return null;
  return ESCALATION_LADDER[i + 1];
}

// Normalise an arbitrary string to a valid EscalationLevel, defaulting to 'l1'.
export function toEscalationLevel(value: unknown): EscalationLevel {
  return value === 'l2' || value === 'human' ? value : 'l1';
}

// The rung that should OWN a given action / a needs-human ticket: money/account
// actions belong at the human gate; everything else starts at L1.
export function tierForAction(action: SupportAction): EscalationLevel {
  return requiresHumanGate(action) ? 'human' : 'l1';
}
