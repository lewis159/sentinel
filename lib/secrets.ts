// Server-only Infisical secrets client (REST API, no SDK).
//
// Bootstrap credentials (the Universal Auth machine identity) live in env vars.
// The actual application secrets (e.g. OPENROUTER_API_KEY) live in Infisical and
// are fetched at runtime through this module.
//
// SECURITY: this module must never be imported by client code. Secret VALUES and
// the client secret are NEVER logged. getSecret returns undefined on any failure
// so callers can fall back to env/DB.

import 'server-only';

const SITE_URL = (process.env.INFISICAL_SITE_URL || 'https://app.infisical.com').replace(/\/+$/, '');
const CLIENT_ID = process.env.INFISICAL_CLIENT_ID;
const CLIENT_SECRET = process.env.INFISICAL_CLIENT_SECRET;
const PROJECT_ID = process.env.INFISICAL_PROJECT_ID;
const ENVIRONMENT = process.env.INFISICAL_ENVIRONMENT || 'prod';

/** True when all Infisical bootstrap env vars are present. */
export function hasInfisical(): boolean {
  return Boolean(SITE_URL && CLIENT_ID && CLIENT_SECRET && PROJECT_ID);
}

// --- Access token cache -----------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

// Log in with the Universal Auth machine identity and cache the access token
// until ~60s before it expires. Returns undefined on any failure.
async function getAccessToken(): Promise<string | undefined> {
  if (!hasInfisical()) return undefined;

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  try {
    const res = await fetch(`${SITE_URL}/api/v1/auth/universal-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as { accessToken?: string; expiresIn?: number };
    if (!json.accessToken) return undefined;

    const expiresIn = typeof json.expiresIn === 'number' ? json.expiresIn : 600;
    cachedToken = {
      token: json.accessToken,
      // Refresh ~60s before actual expiry.
      expiresAt: now + Math.max(0, expiresIn - 60) * 1000,
    };
    return cachedToken.token;
  } catch {
    return undefined;
  }
}

// --- Secret value cache -----------------------------------------------------

const SECRET_TTL_MS = 60_000;
const secretCache = new Map<string, { value: string | undefined; expiresAt: number }>();

/**
 * Read a secret value from Infisical. Returns undefined when Infisical is not
 * configured, the secret is missing (404), or on any error. Resolved values are
 * cached briefly (~60s) to avoid a network hit per call.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  if (!hasInfisical()) return undefined;

  const now = Date.now();
  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const token = await getAccessToken();
    if (!token) return undefined;

    const url =
      `${SITE_URL}/api/v3/secrets/raw/${encodeURIComponent(name)}` +
      `?workspaceId=${encodeURIComponent(PROJECT_ID as string)}` +
      `&environment=${encodeURIComponent(ENVIRONMENT)}` +
      `&secretPath=%2F`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 404) {
      secretCache.set(name, { value: undefined, expiresAt: now + SECRET_TTL_MS });
      return undefined;
    }
    if (!res.ok) return undefined;

    const json = (await res.json()) as { secret?: { secretValue?: string } };
    const value = json.secret?.secretValue;
    secretCache.set(name, { value, expiresAt: now + SECRET_TTL_MS });
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Upsert a secret in Infisical (PATCH to update; POST to create if it doesn't
 * exist yet). On success the cache entry for `name` is invalidated. Never echoes
 * the value back. Returns { ok:false, error } when Infisical is not configured
 * or the write fails.
 */
export async function setSecret(
  name: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasInfisical()) {
    return { ok: false, error: 'Infisical not configured (set INFISICAL_* env vars)' };
  }

  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: 'Infisical auth failed' };

    const body = JSON.stringify({
      workspaceId: PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: '/',
      secretValue: value,
    });
    const headers = {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const base = `${SITE_URL}/api/v3/secrets/raw/${encodeURIComponent(name)}`;

    // Try to update an existing secret first.
    let res = await fetch(base, { method: 'PATCH', headers, body });

    // If it doesn't exist yet, create it.
    if (res.status === 404) {
      res = await fetch(base, { method: 'POST', headers, body });
    }

    if (!res.ok) {
      return { ok: false, error: `Infisical write failed (HTTP ${res.status})` };
    }

    invalidateSecret(name);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Infisical write error' };
  }
}

/** Clear the cached value for a single secret. */
export function invalidateSecret(name: string): void {
  secretCache.delete(name);
}
