import { describe, it, expect } from 'vitest';
import { qualifyLead } from '@/lib/leads/qualify';

// Pure deterministic scorer — no DB, no model, no mocking needed.
describe('qualifyLead — deterministic scoring', () => {
  it('scores a company + business email + intent + budget + urgency lead HOT', () => {
    const a = qualifyLead({
      name: 'Dana Reed',
      email: 'dana@northwind.com',
      company: 'Northwind Media',
      message: 'Interested in enterprise pricing and a demo — we have budget and need this urgently.',
      source: 'web',
    });
    expect(a.tier).toBe('hot');
    expect(a.score).toBeGreaterThanOrEqual(70);
    expect(a.signals.businessEmail).toBe(true);
    expect(a.signals.hasCompany).toBe(true);
    expect(a.signals.intentKeywords).toEqual(expect.arrayContaining(['pricing', 'demo', 'enterprise']));
    expect(a.signals.budget).toBe(true);
    expect(a.signals.urgency).toBe(true);
  });

  it('scores a company + freemail + light intent lead WARM', () => {
    const a = qualifyLead({
      name: 'Sam',
      email: 'sam@gmail.com',
      company: 'Bright Podcasts',
      message: 'Can I get a demo and see your pricing plans?',
      source: 'web',
    });
    expect(a.tier).toBe('warm');
    expect(a.score).toBeGreaterThanOrEqual(40);
    expect(a.score).toBeLessThan(70);
    expect(a.signals.freemail).toBe(true);
    expect(a.signals.businessEmail).toBe(false);
  });

  it('scores a bare freemail enquiry with no company COLD', () => {
    const a = qualifyLead({
      email: 'someone@yahoo.com',
      message: 'hi',
    });
    expect(a.tier).toBe('cold');
    expect(a.score).toBeLessThan(40);
    expect(a.signals.hasCompany).toBe(false);
  });

  it('grades a BUSINESS email strictly higher than the same lead on FREEMAIL', () => {
    const base = { company: 'Acme', message: 'pricing please', source: 'web' };
    const business = qualifyLead({ ...base, email: 'buyer@acme.io' });
    const freemail = qualifyLead({ ...base, email: 'buyer@gmail.com' });
    expect(business.score).toBeGreaterThan(freemail.score);
    expect(business.signals.businessEmail).toBe(true);
    expect(freemail.signals.freemail).toBe(true);
  });

  it('detects purchase-intent keywords and lists them in reasons', () => {
    const a = qualifyLead({ message: 'We want a quote for enterprise seats and an SLA.' });
    expect(a.signals.intentKeywords).toEqual(
      expect.arrayContaining(['quote', 'enterprise', 'seats', 'sla']),
    );
    expect(a.reasons.join(' ')).toMatch(/Purchase-intent keywords/);
  });

  it('is bounded 0..100 and pure (same input → same output)', () => {
    const input = { email: 'a@b.com', company: 'X', message: 'pricing demo budget urgent enterprise' };
    const a = qualifyLead(input);
    const b = qualifyLead(input);
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});
