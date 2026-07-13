// Console settings STORE — server-only persistence over ops.console_settings.
//
// The single read/write path behind the Sentinel v2 Settings hub. Mirrors the
// mock-safe shape used elsewhere in the estate:
//   * getSettings()  — never throws; with no DB (or before the table exists) it
//     returns an EMPTY map, i.e. every field reads back BLANK.
//   * setSetting()   — lazily creates the table on first write and upserts one
//     key; a blank/unset value DELETES the row so the field reads back blank.
//
// Nothing here fabricates a value: an unset key is simply absent from the map.

import 'server-only';
import { hasDb, q } from '@/lib/db';
import {
  CONSOLE_SETTINGS,
  getSettingDef,
  validateSetting,
} from '@/lib/settings/schema';

// A map of key → stored value. Unset keys are ABSENT (not null) so the UI can
// distinguish "never saved" from an explicit value.
export type SettingsMap = Record<string, unknown>;

const ALL_KEYS = CONSOLE_SETTINGS.map((d) => d.key);

// Idempotently ensure the table exists. Called lazily from the write path.
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.console_settings (
       key        text primary key,
       value      jsonb,
       updated_at timestamptz default now(),
       updated_by text
     )`,
  );
}

/**
 * Read stored settings. Pass `keys` to restrict to a subset (unknown keys are
 * ignored); omit to read every known key. Blanks are represented by ABSENCE.
 *
 * Mock-safe: no DB, or a missing table, or any query error → an empty map. Never
 * throws, never fabricates.
 */
export async function getSettings(keys?: string[]): Promise<SettingsMap> {
  const wanted = (keys && keys.length ? keys : ALL_KEYS).filter((k) => getSettingDef(k));
  if (!hasDb || wanted.length === 0) return {};

  try {
    const rows = await q<{ key: string; value: unknown }>(
      `select key, value from ops.console_settings where key = any($1)`,
      [wanted],
    );
    const out: SettingsMap = {};
    for (const r of rows) {
      // `value` is jsonb → pg returns it already parsed. Skip null/absent so an
      // explicitly-cleared row reads back as blank (unset), never as a value.
      if (r.value === null || r.value === undefined) continue;
      out[r.key] = r.value;
    }
    return out;
  } catch {
    // Table not created yet, or DB unreachable → treat everything as unset.
    return {};
  }
}

export type SetResult = { ok: boolean; error?: string };

/**
 * Upsert (or clear) one setting after validating it against the schema. A blank
 * value clears the key (row deleted → reads back blank). Returns { ok:false }
 * with a message on a validation error or when there is no database.
 */
export async function setSetting(
  key: string,
  value: unknown,
  by?: string | null,
): Promise<SetResult> {
  const check = validateSetting(key, value);
  if (!check.ok) return { ok: false, error: check.error };

  if (!hasDb) {
    return { ok: false, error: 'No database in this environment — cannot persist settings.' };
  }

  try {
    await ensureTable();
    if (check.unset) {
      await q(`delete from ops.console_settings where key = $1`, [key]);
      return { ok: true };
    }
    await q(
      `insert into ops.console_settings (key, value, updated_at, updated_by)
       values ($1, $2::jsonb, now(), $3)
       on conflict (key) do update
         set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, JSON.stringify(check.value), by ?? null],
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to save setting' };
  }
}

export type SetManyResult = {
  ok: boolean;
  error?: string;
  written: string[];
};

/**
 * Validate + persist several settings at once (one section's worth). Validation
 * is all-or-nothing: if ANY value is invalid, nothing is written and the first
 * error is returned. On success `written` lists the keys that were changed
 * (set or cleared).
 */
export async function setSettings(
  entries: Record<string, unknown>,
  by?: string | null,
): Promise<SetManyResult> {
  const keys = Object.keys(entries);

  // Validate everything up front.
  for (const k of keys) {
    const check = validateSetting(k, entries[k]);
    if (!check.ok) return { ok: false, error: check.error, written: [] };
  }

  if (keys.length === 0) return { ok: true, written: [] };

  if (!hasDb) {
    return {
      ok: false,
      error: 'No database in this environment — cannot persist settings.',
      written: [],
    };
  }

  const written: string[] = [];
  for (const k of keys) {
    const res = await setSetting(k, entries[k], by);
    if (!res.ok) return { ok: false, error: res.error, written };
    written.push(k);
  }
  return { ok: true, written };
}
