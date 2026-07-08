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
