// Sales / Lead-qualification SCORER — pure, deterministic, mock-safe.
//
// Given an inbound enquiry (name / email / company / message / source) this
// returns a { score, tier, reasons, signals } assessment computed ENTIRELY from
// deterministic rules — no DB, no model, no I/O. That keeps it trivially
// unit-testable and means the public intake path can score a lead inline without
// any external call (so the surface stays cheap and dormant-safe).
//
// The optional LLM refinement (brain pass that rewrites the tier + drafts a
// suggested reply) lives in ./refine.ts so THIS module never imports the model
// client and stays a pure function. When HERMES_BRAIN_ENABLED is off, only this
// deterministic scorer runs — leads are still ranked hot → warm → cold.

export type LeadInput = {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  message?: string | null;
  source?: string | null;
};

export type LeadTier = 'hot' | 'warm' | 'cold';

export type LeadSignals = {
  hasCompany: boolean;
  businessEmail: boolean;
  freemail: boolean;
  hasEmail: boolean;
  intentKeywords: string[];
  urgency: boolean;
  budget: boolean;
  detailed: boolean;
};

export type LeadAssessment = {
  score: number; // 0-100
  tier: LeadTier;
  reasons: string[];
  signals: LeadSignals;
};

// Tier cut-offs. Kept as named constants so the page/tests read the same values.
export const TIER_THRESHOLDS = { hot: 70, warm: 40 } as const;

// Free / consumer email providers — a business-domain address is a stronger
// buying signal than a personal one, so we grade them differently.
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'gmx.co.uk', 'mail.com', 'yandex.com',
  'zoho.com', 'hey.com', 'fastmail.com',
]);

// Purchase-intent vocabulary. A hit is a strong signal the enquiry is pre-sale
// (someone evaluating / ready to buy) rather than generic support.
const INTENT_KEYWORDS = [
  'pricing', 'price', 'cost', 'quote', 'demo', 'trial', 'enterprise', 'buy',
  'purchase', 'upgrade', 'plan', 'plans', 'subscription', 'contract', 'sla',
  'onboard', 'onboarding', 'migrate', 'migration', 'integration', 'integrate',
  'seats', 'seat', 'team', 'invoice', 'procurement', 'reseller',
];

// Urgency + budget hint vocabularies (each contributes a single bonus).
const URGENCY_KEYWORDS = [
  'asap', 'urgent', 'urgently', 'immediately', 'today', 'this week',
  'this quarter', 'this month', 'deadline', 'soon', 'right away',
];
const BUDGET_KEYWORDS = [
  'budget', 'per month', 'per year', 'per seat', '/mo', '/month', 'annually',
  'spend', 'k/yr', 'k budget',
];

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Whole-word-ish presence test (case-insensitive), tolerant of punctuation.
function mentions(haystack: string, needle: string): boolean {
  if (needle.includes(' ') || needle.includes('/')) return haystack.includes(needle);
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.includes('.') ? domain : null;
}

/**
 * Score & qualify a lead from deterministic signals. Pure — no I/O, no model.
 * Always returns a bounded score (0-100), a tier, and human-readable reasons.
 */
export function qualifyLead(input: LeadInput): LeadAssessment {
  const company = norm(input.company);
  const email = norm(input.email).toLowerCase();
  const message = norm(input.message);
  const haystack = `${message} ${company}`.toLowerCase();

  const domain = email ? emailDomain(email) : null;
  const hasEmail = Boolean(domain);
  const freemail = hasEmail && FREEMAIL_DOMAINS.has(domain!);
  const businessEmail = hasEmail && !freemail;

  const intentKeywords = Array.from(
    new Set(INTENT_KEYWORDS.filter((k) => mentions(haystack, k))),
  );
  const urgency = URGENCY_KEYWORDS.some((k) => mentions(haystack, k));
  const budget = BUDGET_KEYWORDS.some((k) => mentions(haystack, k));
  const detailed = message.length >= 180;
  const hasCompany = company.length > 0;

  const reasons: string[] = [];
  let score = 15; // baseline for any genuine enquiry

  if (hasCompany) {
    score += 15;
    reasons.push(`Company provided (${company})`);
  } else {
    reasons.push('No company named');
  }

  if (businessEmail) {
    score += 25;
    reasons.push(`Business email domain (${domain})`);
  } else if (freemail) {
    score += 3;
    reasons.push(`Free email provider (${domain}) — lower intent`);
  } else {
    reasons.push('No email address provided');
  }

  if (intentKeywords.length > 0) {
    const bump = Math.min(intentKeywords.length * 7, 28);
    score += bump;
    reasons.push(`Purchase-intent keywords: ${intentKeywords.join(', ')}`);
  }

  if (urgency) {
    score += 10;
    reasons.push('Urgency / timeline signalled');
  }

  if (budget) {
    score += 12;
    reasons.push('Budget / spend mentioned');
  }

  if (detailed) {
    score += 6;
    reasons.push('Detailed enquiry');
  }

  score = Math.max(0, Math.min(100, score));

  const tier: LeadTier =
    score >= TIER_THRESHOLDS.hot ? 'hot' : score >= TIER_THRESHOLDS.warm ? 'warm' : 'cold';

  return {
    score,
    tier,
    reasons,
    signals: {
      hasCompany,
      businessEmail,
      freemail,
      hasEmail,
      intentKeywords,
      urgency,
      budget,
      detailed,
    },
  };
}
