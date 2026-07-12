// Hermes agent metadata — CLIENT-SAFE pure data (no server imports). Shared by
// the triage API (section gating, proposal labels) and the HermesPanel UI
// (header / button / action / tagline text + the comment kind each agent posts).
export type AgentKey = 'support' | 'incident' | 'escalation' | 'billing' | 'security';

export const AGENT_META: Record<
  AgentKey,
  {
    header: string;
    button: string;
    action: string;
    tagline: string;
    section: 'support' | 'operations' | 'security';
    commentKind: string;
  }
> = {
  support:    { header:'Hermes · Support',           button:'Draft a reply',     action:'Send reply',          tagline:'Hermes drafts a customer reply for you to review — nothing sends without you.', section:'support',    commentKind:'reply' },
  incident:   { header:'Hermes · Incident response', button:'Assess incident',   action:'Post recommendation', tagline:'Hermes assesses the incident and recommends next steps — nothing acts without you.', section:'operations', commentKind:'update' },
  escalation: { header:'Hermes · Escalations',       button:'Draft escalation',  action:'Post escalation',     tagline:'Hermes drafts an escalation summary + who to loop in.', section:'support',    commentKind:'update' },
  billing:    { header:'Hermes · Billing (CFO)',     button:'Assess billing',    action:'Post recommendation', tagline:'Hermes reviews the billing/refund request and recommends — money always needs you.', section:'support', commentKind:'update' },
  security:   { header:'Hermes · Security',          button:'Assess security',   action:'Post assessment',     tagline:'Hermes assesses the security finding and recommends remediation.', section:'security',   commentKind:'update' },
};

// The RBAC sections the estate already gates by. Reused for the exec roster below
// (we do NOT invent new sections). Kept in sync with AGENT_META[*].section.
export type RbacSection = 'support' | 'operations' | 'security';

// ---------------------------------------------------------------------------
// Exec roster metadata (CLIENT-SAFE pure data).
//
// The five entries in AGENT_META above are the DRAFT-ONLY department copilots
// (keyed by AgentKey) that the HermesPanel UI + copilot routes drive. The full
// Hermes exec bench also includes agentic personas that are NOT copilot draft
// surfaces — the PA (the above-the-line profile) and, added here, the two
// remaining execs that complete the "Full 7": CEO / Chief-of-Staff and Risk /
// Red-team. They register as Brain personas (see brain/personas/execs.ts); this
// is their lightweight roster metadata (id, label, section, description).
//
// Deliberately a SEPARATE structure from AGENT_META so we do NOT widen AgentKey —
// the copilot routes/UI (which switch on AgentKey) stay scoped to the five
// copilots and are completely unaffected. Each exec maps to an EXISTING RbacSection.
export type ExecRosterEntry = {
  id: string;
  label: string;
  section: RbacSection; // reused existing RBAC section — no new section invented
  description: string;
  advisory?: boolean;   // true → advisory-only (produces analysis/proposals, never acts)
};

export const EXEC_ROSTER: Record<'ceo' | 'risk', ExecRosterEntry> = {
  ceo: {
    id: 'ceo',
    label: 'CEO / Chief-of-Staff',
    section: 'operations', // closest existing RBAC section for cross-exec prioritisation
    description:
      'Turns intent into prioritised work, resolves competing exec demands, and runs the weekly review. Recommends direction (read-only); its gate is Ben approving the scope.',
  },
  risk: {
    id: 'risk',
    label: 'Risk / Red-team',
    section: 'security', // closest existing RBAC section for pressure-testing/pre-mortems
    description:
      'Challenges big calls, runs pre-mortems, and pressure-tests security. Advisory-only — produces analysis and recommendations and never executes anything.',
    advisory: true,
  },
};
