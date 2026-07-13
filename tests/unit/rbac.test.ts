import { describe, it, expect } from 'vitest';
import {
  resolveSections,
  hasSection,
  sectionForPath,
  ALL_SECTIONS,
} from '@/lib/v2/rbac';

const sorted = (arr: readonly string[]) => [...arr].sort();

describe('resolveSections', () => {
  it('gives global_admin every section', () => {
    expect(sorted(resolveSections('global_admin'))).toEqual(sorted(ALL_SECTIONS));
  });

  it('resolves support_lead to overview + support (order-insensitive)', () => {
    expect(sorted(resolveSections('support_lead'))).toEqual(
      sorted(['overview', 'support']),
    );
  });

  it('always includes overview for an unknown/undefined role', () => {
    expect(resolveSections(undefined)).toContain('overview');
  });

  it('respects an explicit override (and always unions overview)', () => {
    const result = resolveSections('sre', ['overview', 'security']);
    expect(result).toContain('security');
    expect(result).toContain('overview');
    // The sre preset would grant 'operations'; the override must suppress it.
    expect(result).not.toContain('operations');
  });
});

describe('hasSection', () => {
  it('grants admin to global_admin', () => {
    expect(hasSection('global_admin', undefined, 'admin')).toBe(true);
  });

  it('denies operations to support_lead', () => {
    expect(hasSection('support_lead', undefined, 'operations')).toBe(false);
  });
});

describe('sectionForPath', () => {
  const cases: Array<[string, string]> = [
    ['/v2', 'overview'],
    ['/v2/operations', 'operations'],
    ['/v2/incidents', 'operations'],
    ['/v2/security', 'security'],
    ['/v2/reports', 'security'],
    ['/v2/admin', 'admin'],
    ['/v2/access/apps', 'admin'],
    ['/v2/settings', 'admin'],
    ['/v2/hermes', 'hermes'],
    ['/v2/hermes/floor', 'hermes'],
    ['/v2/hermes/integrations', 'admin'],
    ['/v2/hermes/governance', 'admin'],
    ['/v2/kb', 'overview'],
    ['/v2/support/OPS-1', 'support'],
  ];

  for (const [path, expected] of cases) {
    it(`maps ${path} -> ${expected}`, () => {
      expect(sectionForPath(path)).toBe(expected);
    });
  }
});
