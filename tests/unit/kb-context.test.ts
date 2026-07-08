import { describe, it, expect } from 'vitest';
import { retrieveKb } from '@/lib/hermes/kb-context';

describe('retrieveKb', () => {
  it('returns a relevant snippet for a rate-limit query', async () => {
    const results = await retrieveKb('API returns 429 rate limit');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const top = results[0];
    expect(top.slug).toBe('rate-limiting');
    expect(top.title.toLowerCase()).toContain('rate limit');
  });

  it('returns [] for a nonsense query with no overlap', async () => {
    const results = await retrieveKb('zzzq xqjk');
    expect(results).toEqual([]);
  });

  it('respects the limit param', async () => {
    const results = await retrieveKb('failed payment plan upgrade credit', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
