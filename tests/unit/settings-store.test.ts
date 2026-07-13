import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Console settings STORE (lib/settings/store.ts) + SCHEMA (lib/settings/schema.ts).
//
// Proves the honesty invariants:
//   * the schema seeds NO values (blank is the only default),
//   * getSettings returns BLANK (empty map) with no DB and never throws,
//   * getSettings maps stored rows and OMITS unset/null rows (stays blank),
//   * setSetting persists a valid value and CLEARS on blank,
//   * validation rejects unknown keys and type mismatches,
//   * set is mock-safe (no DB → ok:false, never throws).
//
// The DB is mocked: a mutable in-memory `rows` table stands in for
// ops.console_settings so we can assert what setSetting would write.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const rows = new Map<string, unknown>();
  const q = vi.fn(async (text: string, params?: any[]) => {
    const t = text.toLowerCase();
    if (t.includes('create table')) return [];
    if (t.startsWith('select')) {
      const keys: string[] = (params?.[0] as string[]) ?? [];
      return keys
        .filter((k) => rows.has(k))
        .map((k) => ({ key: k, value: rows.get(k) }));
    }
    if (t.startsWith('insert')) {
      const [key, valueJson] = params as [string, string, string?];
      rows.set(key, JSON.parse(valueJson));
      return [];
    }
    if (t.startsWith('delete')) {
      const [key] = params as [string];
      rows.delete(key);
      return [];
    }
    return [];
  });
  return { state, rows, q };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
}));

import { getSettings, setSetting, setSettings } from '@/lib/settings/store';
import { CONSOLE_SETTINGS, validateSetting } from '@/lib/settings/schema';

beforeEach(() => {
  H.state.dbPresent = true;
  H.rows.clear();
  H.q.mockClear();
});

describe('schema — no seeded values', () => {
  it('every definition is blank (carries no value/default)', () => {
    for (const def of CONSOLE_SETTINGS) {
      expect(def).not.toHaveProperty('value');
      expect(def).not.toHaveProperty('default');
      // required descriptor fields only
      expect(typeof def.key).toBe('string');
      expect(typeof def.type).toBe('string');
    }
  });
});

describe('getSettings — blank by default', () => {
  it('returns an empty map with no DB and never throws', async () => {
    H.state.dbPresent = false;
    await expect(getSettings()).resolves.toEqual({});
  });

  it('returns an empty map when nothing is stored', async () => {
    await expect(getSettings()).resolves.toEqual({});
  });

  it('never throws even if the query blows up', async () => {
    H.q.mockImplementationOnce(async () => {
      throw new Error('db exploded');
    });
    await expect(getSettings()).resolves.toEqual({});
  });
});

describe('setSetting — persists + clears', () => {
  it('persists a valid value that then reads back', async () => {
    const res = await setSetting('org_name', 'Acme Ops', 'global_admin');
    expect(res.ok).toBe(true);
    await expect(getSettings(['org_name'])).resolves.toEqual({ org_name: 'Acme Ops' });
  });

  it('a blank value CLEARS the key (reads back blank/unset)', async () => {
    await setSetting('org_name', 'Acme Ops');
    await setSetting('org_name', '   ');
    await expect(getSettings(['org_name'])).resolves.toEqual({});
  });

  it('coerces + persists a boolean and a number', async () => {
    await setSetting('env_banner_enabled', true);
    await setSetting('sla_p1_hours', '4');
    await expect(getSettings(['env_banner_enabled', 'sla_p1_hours'])).resolves.toEqual({
      env_banner_enabled: true,
      sla_p1_hours: 4,
    });
  });

  it('rejects an unknown key', async () => {
    const res = await setSetting('not_a_real_key', 'x');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown/i);
  });

  it('rejects a value outside a select option set', async () => {
    const res = await setSetting('default_theme', 'neon');
    expect(res.ok).toBe(false);
  });

  it('is mock-safe with no DB (ok:false, never throws)', async () => {
    H.state.dbPresent = false;
    const res = await setSetting('org_name', 'Acme');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/database/i);
  });
});

describe('setSettings — bulk, all-or-nothing', () => {
  it('writes several keys and lists them', async () => {
    const res = await setSettings(
      { sla_p1_hours: '1', sla_p2_hours: '4', sla_p3_hours: '8' },
      'global_admin',
    );
    expect(res.ok).toBe(true);
    expect(res.written.sort()).toEqual(['sla_p1_hours', 'sla_p2_hours', 'sla_p3_hours']);
  });

  it('writes NOTHING when any value is invalid', async () => {
    const res = await setSettings({ sla_p1_hours: '1', default_theme: 'neon' });
    expect(res.ok).toBe(false);
    expect(res.written).toEqual([]);
    // The valid one must NOT have been persisted.
    await expect(getSettings(['sla_p1_hours'])).resolves.toEqual({});
  });
});

describe('validateSetting — pure', () => {
  it('treats blank as unset for every type', () => {
    expect(validateSetting('org_name', '')).toMatchObject({ ok: true, unset: true });
    expect(validateSetting('sla_p1_hours', null)).toMatchObject({ ok: true, unset: true });
  });

  it('rejects a non-numeric number', () => {
    expect(validateSetting('sla_p1_hours', 'abc').ok).toBe(false);
  });
});
