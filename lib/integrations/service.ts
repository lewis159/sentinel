// Server-only service layer for the Integrations admin page.
//
// Ties the pure registry (lib/integrations/registry.ts) to the real secret store
// (Infisical hermes/prod, via lib/secrets) and the runtime flag store
// (lib/hermes/runtime-flags). Everything here runs on the server ONLY.
//
// SECURITY CONTRACT:
//   - buildIntegrationStatus() returns PRESENCE + updatedAt + flag state ONLY.
//     It NEVER returns a secret value (it uses getSecretMeta, not getSecret).
//   - writeIntegrationKey() writes the key to Infisical and NEVER echoes it back.
//   - runIntegrationTest() reads the key server-side, runs the provider probe,
//     and returns only { ok, detail } — never the key.
//   - Every write (key set / flag toggle) is appended to the hash-chained audit
//     log WITHOUT the value.

import 'server-only';
import { getSecret, getSecretMeta, setSecret, hasInfisical } from '@/lib/secrets';
import {
  INTEGRATIONS,
  getIntegration,
  isTestable,
  type IntegrationDef,
} from '@/lib/integrations/registry';
import {
  getRuntimeFlagState,
  setRuntimeFlag,
  type RuntimeFlagState,
} from '@/lib/hermes/runtime-flags';
import { appendAudit } from '@/lib/hermes/audit';

export type SecretKeyStatus = {
  key: string;
  present: boolean;
  updatedAt?: string;
};

export type IntegrationStatus = {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  testable: boolean;
  flag?: string;
  /** Per-secret presence/updatedAt — NEVER the value. */
  secrets: SecretKeyStatus[];
  /** True when every mapped secret is present in Infisical. */
  configured: boolean;
  /** Most-recent updatedAt across the mapped secrets, if any. */
  updatedAt?: string;
  /** Resolved feature-flag state (DB override → env default), if the integration drives one. */
  flagState?: RuntimeFlagState;
};

export type IntegrationsPayload = {
  /** True when the Infisical machine identity is configured (writes possible). */
  infisicalConfigured: boolean;
  integrations: IntegrationStatus[];
};

// Build the status for one integration. Reads ONLY metadata (never values).
async function statusFor(def: IntegrationDef): Promise<IntegrationStatus> {
  const secrets: SecretKeyStatus[] = await Promise.all(
    def.secretKeys.map(async (key) => {
      const meta = await getSecretMeta(key);
      return { key, present: meta.exists, updatedAt: meta.updatedAt };
    }),
  );

  const configured = secrets.length > 0 && secrets.every((s) => s.present);

  // Most-recent updatedAt across present secrets.
  const stamps = secrets
    .map((s) => s.updatedAt)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort();
  const updatedAt = stamps.length ? stamps[stamps.length - 1] : undefined;

  const flagState = def.flag ? await getRuntimeFlagState(def.flag) : undefined;

  return {
    id: def.id,
    label: def.label,
    description: def.description,
    docsUrl: def.docsUrl,
    testable: isTestable(def),
    flag: def.flag,
    secrets,
    configured,
    updatedAt,
    flagState,
  };
}

/**
 * Full page payload: every integration's status + whether Infisical is wired for
 * writes. NEVER contains a secret value.
 */
export async function buildIntegrationsPayload(): Promise<IntegrationsPayload> {
  const integrations = await Promise.all(INTEGRATIONS.map(statusFor));
  return { infisicalConfigured: hasInfisical(), integrations };
}

/**
 * Write (create / rotate) an integration's primary key to Infisical hermes/prod.
 * The value is NEVER echoed back or logged; only presence is audited.
 */
export async function writeIntegrationKey(
  id: string,
  value: string,
  actor?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const def = getIntegration(id);
  if (!def) return { ok: false, error: `Unknown integration: ${id}` };

  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: 'Key value is empty.' };

  const res = await setSecret(def.primaryKey, trimmed);
  if (!res.ok) return res;

  // Audit the ROTATION — who, which secret, when. NEVER the value.
  await appendAudit({
    actor: actor ?? null,
    action: 'integration.key.set',
    tool: def.id,
    summary: `Set/rotated ${def.label} key (${def.primaryKey})`,
    detail: { integration: def.id, secretKey: def.primaryKey },
  });

  return { ok: true };
}

/**
 * Run an integration's live connection test against the CURRENTLY-STORED key.
 * The key is read server-side (Infisical → env fallback) and passed to the
 * probe; it is never returned. The result (ok/detail) is audited.
 */
export async function runIntegrationTest(
  id: string,
  actor?: string | null,
): Promise<IntegrationTestOutcome> {
  const def = getIntegration(id);
  if (!def) return { ok: false, detail: `Unknown integration: ${id}`, status: 'unknown' };
  if (!def.test) return { ok: false, detail: 'This integration has no connection test.', status: 'unknown' };

  // Key precedence mirrors the runtime: Infisical → process.env.
  const key = (await getSecret(def.primaryKey)) || process.env[def.primaryKey] || '';
  if (!key) {
    return { ok: false, detail: `No ${def.primaryKey} configured to test.`, status: 'not_configured' };
  }

  let result: { ok: boolean; detail: string };
  try {
    result = await def.test(key);
  } catch {
    result = { ok: false, detail: 'Test threw unexpectedly.' };
  }

  await appendAudit({
    actor: actor ?? null,
    action: 'integration.test',
    tool: def.id,
    summary: `Tested ${def.label}: ${result.ok ? 'ok' : 'failed'}`,
    detail: { integration: def.id, ok: result.ok, detail: result.detail },
  });

  return { ...result, status: result.ok ? 'ok' : 'fail' };
}

export type IntegrationTestOutcome = {
  ok: boolean;
  detail: string;
  status: 'ok' | 'fail' | 'not_configured' | 'unknown';
};

/**
 * Toggle the runtime feature flag an integration drives. Writes the DB override
 * and audits the change.
 */
export async function setIntegrationFlag(
  id: string,
  enabled: boolean,
  actor?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const def = getIntegration(id);
  if (!def) return { ok: false, error: `Unknown integration: ${id}` };
  if (!def.flag) return { ok: false, error: `${def.label} does not drive a feature flag.` };

  const res = await setRuntimeFlag(def.flag, enabled, actor ?? null);
  if (!res.ok) return res;

  await appendAudit({
    actor: actor ?? null,
    action: 'integration.flag.set',
    tool: def.id,
    summary: `${enabled ? 'Enabled' : 'Disabled'} ${def.flag} (${def.label})`,
    detail: { integration: def.id, flag: def.flag, enabled },
  });

  return { ok: true };
}
