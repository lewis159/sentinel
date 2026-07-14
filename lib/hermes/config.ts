// Server-only runtime config for the Hermes / OpenRouter provider.
//
// Admins can set the OpenRouter API key + model from the UI; those values are
// stored in ops.app_config (DB) and take precedence over the environment. When
// there's no DB (or no stored value) we fall back to process.env.
//
// SECURITY: the API key is only ever exposed to the runtime (getHermesRuntimeConfig).
// The client-facing surface (getPublicHermesConfig) NEVER returns the raw key —
// only a boolean + a masked hint. Never log the key.

import 'server-only';
import { hasDb, q } from '@/lib/db';
import { getSecret, setSecret, hasInfisical } from '@/lib/secrets';

export const DEFAULT_HERMES_MODEL = 'anthropic/claude-3.5-sonnet';

// Name of the OpenRouter API key secret in Infisical.
const INFISICAL_OPENROUTER_KEY = 'OPENROUTER_API_KEY';

const KEY_APIKEY = 'hermes.openrouter_key';
const KEY_MODEL = 'hermes.model';

type ConfigSource = 'infisical' | 'db' | 'env' | 'none';

// Idempotently ensure the config table exists. Called lazily from the write path.
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.app_config (
       key text primary key,
       value text,
       updated_at timestamptz default now()
     )`,
  );
}

// Read both config rows from the DB. Returns a partial map; empty on any failure
// so callers can fall back to the environment.
async function readDbConfig(): Promise<{ apiKey?: string; model?: string }> {
  if (!hasDb) return {};
  try {
    const rows = await q<{ key: string; value: string | null }>(
      `select key, value from ops.app_config where key = any($1)`,
      [[KEY_APIKEY, KEY_MODEL]],
    );
    const out: { apiKey?: string; model?: string } = {};
    for (const r of rows) {
      const val = typeof r.value === 'string' ? r.value.trim() : '';
      if (!val) continue;
      if (r.key === KEY_APIKEY) out.apiKey = val;
      else if (r.key === KEY_MODEL) out.model = val;
    }
    return out;
  } catch {
    // Table may not exist yet, or DB unreachable → fall back to env.
    return {};
  }
}

/**
 * SERVER-ONLY read used by the runtime (includes the raw API key).
 * Key precedence: Infisical → process.env → DB value. Never expose this to the
 * client. Model is NOT a secret: DB → env → default (unchanged).
 */
export async function getHermesRuntimeConfig(): Promise<{
  apiKey?: string;
  model: string;
  hasKey: boolean;
  source: ConfigSource;
}> {
  const db = await readDbConfig();

  const fromInfisical = await getSecret(INFISICAL_OPENROUTER_KEY);

  let apiKey: string | undefined;
  let source: ConfigSource;
  if (fromInfisical) {
    apiKey = fromInfisical;
    source = 'infisical';
  } else if (process.env.OPENROUTER_API_KEY) {
    apiKey = process.env.OPENROUTER_API_KEY;
    source = 'env';
  } else if (db.apiKey) {
    apiKey = db.apiKey;
    source = 'db';
  } else {
    apiKey = undefined;
    source = 'none';
  }

  const model =
    db.model || process.env.HERMES_MODEL || DEFAULT_HERMES_MODEL;

  return { apiKey, model, hasKey: Boolean(apiKey), source };
}

/**
 * CLIENT-FACING read. Same as the runtime read but OMITS the raw key. When a key
 * is present, exposes only a masked hint ('••••' + last 4 chars). This is what
 * the settings API returns to the browser.
 */
export async function getPublicHermesConfig(): Promise<{
  model: string;
  hasKey: boolean;
  keyHint?: string;
  source: ConfigSource;
}> {
  const { apiKey, model, hasKey, source } = await getHermesRuntimeConfig();
  const keyHint =
    hasKey && apiKey ? `••••${apiKey.slice(-4)}` : undefined;
  return { model, hasKey, keyHint, source };
}

/**
 * Admin write path.
 *
 * The API key is written to Infisical (the PREFERRED store) when Infisical is
 * configured, AND ALSO persisted to ops.app_config (KEY_APIKEY) as the durable
 * fallback so the UI "Save key" works with NO Infisical and NO env var. The read
 * path (getHermesRuntimeConfig) already resolves Infisical → env → DB, so the
 * DB-persisted key is picked up on the fly and survives redeploys. The model is
 * NOT secret and is persisted to ops.app_config as before.
 *
 *   - clearKey        → blank the key in Infisical (if configured) + delete the DB row
 *   - apiKey (set)    → write to Infisical (if configured) + upsert the DB row
 *   - model (set)     → upsert the model in the DB
 *   - model === ''    → delete the model row (falls back to default)
 *
 * When both model + apiKey are provided, both are written and the call only
 * succeeds if both succeed (the first error is surfaced).
 *
 * SECURITY: persisting the key in ops.app_config is PLAINTEXT-AT-REST — the same
 * exposure class as an OPENROUTER_API_KEY env var. Infisical remains the
 * preferred store; the DB row is a fallback so the feature works without it. The
 * key is NEVER logged and NEVER echoed to the client (getPublicHermesConfig
 * masks it). Encrypting this column is a tracked follow-up.
 */
export async function setHermesConfig(input: {
  model?: string;
  apiKey?: string;
  clearKey?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  // --- Secret (API key) → Infisical (preferred) + DB (durable fallback) ------
  if (input.clearKey) {
    // Best-effort: blank the key in Infisical. Skip silently if not configured.
    if (hasInfisical()) {
      const res = await setSecret(INFISICAL_OPENROUTER_KEY, '');
      if (!res.ok) return res;
    }
    // Remove the DB-persisted key so the runtime falls back to env/none.
    if (hasDb) {
      try {
        await ensureTable();
        await q(`delete from ops.app_config where key = $1`, [KEY_APIKEY]);
      } catch (e: any) {
        return { ok: false, error: e?.message ?? 'Failed to clear Hermes API key' };
      }
    }
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const key = input.apiKey.trim();
    // Write to Infisical when configured (preferred store).
    if (hasInfisical()) {
      const res = await setSecret(INFISICAL_OPENROUTER_KEY, key);
      if (!res.ok) return res;
    }
    // ALSO persist to the DB so the key survives without Infisical / env, and is
    // resolved by getHermesRuntimeConfig's existing `db` branch. Mirror exactly
    // how the model is upserted below.
    if (hasDb) {
      try {
        await ensureTable();
        await q(
          `insert into ops.app_config (key, value, updated_at)
           values ($1, $2, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [KEY_APIKEY, key],
        );
      } catch (e: any) {
        return { ok: false, error: e?.message ?? 'Failed to save Hermes API key' };
      }
    } else if (!hasInfisical()) {
      // No Infisical AND no DB → nowhere durable to store the key.
      return {
        ok: false,
        error:
          'No database or Infisical in this environment — set OPENROUTER_API_KEY via an env var instead.',
      };
    }
  }

  // --- Model → DB -----------------------------------------------------------
  const wantsModelWrite = typeof input.model === 'string';
  if (wantsModelWrite) {
    if (!hasDb) {
      return {
        ok: false,
        error:
          'No database in this environment — set HERMES_MODEL via an env var instead.',
      };
    }
    try {
      await ensureTable();

      const model = (input.model as string).trim();
      if (model) {
        await q(
          `insert into ops.app_config (key, value, updated_at)
           values ($1, $2, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [KEY_MODEL, model],
        );
      } else {
        // Empty string → clear override, fall back to env/default.
        await q(`delete from ops.app_config where key = $1`, [KEY_MODEL]);
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Failed to save Hermes model' };
    }
  }

  return { ok: true };
}
