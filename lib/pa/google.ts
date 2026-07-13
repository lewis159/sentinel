// Google auth/token layer for the PA (Personal Assistant) — the shared token
// source + fetch helper for the PA's Google Calendar + Gmail tools.
//
// AUTH MODEL (v1): the PA acts as ONE principal (Ben). It reads a Google OAuth
// access token, in this precedence:
//   1. process.env.PA_GOOGLE_ACCESS_TOKEN          (a stored access token)
//   2. Infisical getSecret('PA_GOOGLE_ACCESS_TOKEN')
//   3. a refresh-token exchange (PA_GOOGLE_REFRESH_TOKEN + client id/secret),
//      documented below — optional, so a stored access token alone is enough.
// Missing token → getGoogleAccessToken() returns undefined and every tool reports
// a clean `not_configured` result (it NEVER throws).
//
// The token / client secret are NEVER hardcoded and NEVER logged.
//
// ---------------------------------------------------------------------------
// OAUTH SETUP (the manual step Ben completes once — documented, not automated)
// ---------------------------------------------------------------------------
// A full interactive OAuth consent dance can't be driven here, so v1 accepts a
// stored access token (and optionally a long-lived refresh token). To provision:
//   1. In Google Cloud Console create an OAuth 2.0 Client (type: Web / Desktop).
//   2. Grant these SCOPES on the consent screen:
//        https://www.googleapis.com/auth/calendar         (read + create events)
//        https://www.googleapis.com/auth/gmail.readonly    (read recent mail)
//        https://www.googleapis.com/auth/gmail.compose      (create drafts)
//        https://www.googleapis.com/auth/gmail.send         (optional — Gmail send)
//      (The PA's outbound *send* can also go via the estate's Resend `sendEmail`
//       tool, which needs no Gmail scope — see lib/hermes/brain/tools/email.ts.)
//   3. Run the consent flow once (e.g. the OAuth Playground) to mint tokens.
//   4. Paste the ACCESS TOKEN on the PA connect page (stored in Infisical as
//      PA_GOOGLE_ACCESS_TOKEN), OR set the refresh-token env trio below so the PA
//      refreshes its own access token:
//        PA_GOOGLE_REFRESH_TOKEN, PA_GOOGLE_CLIENT_ID, PA_GOOGLE_CLIENT_SECRET.
import 'server-only';
import { getSecret } from '@/lib/secrets';

/** The Infisical / env secret name that holds the PA's Google access token. */
export const PA_GOOGLE_TOKEN_KEY = 'PA_GOOGLE_ACCESS_TOKEN';

/** The clean "not connected" message every PA Google tool returns when unconfigured. */
export const PA_GOOGLE_NOT_CONFIGURED =
  'Google not connected — no PA Google access token. Connect a Google account on the PA connect page (env PA_GOOGLE_ACCESS_TOKEN, an Infisical secret, or the refresh-token env trio).';

// In-memory cache for a refresh-token-derived access token (refreshed ~60s early).
let cachedRefreshToken: { token: string; expiresAt: number } | null = null;

// OAuth refresh exchange — only used when no static access token is present AND
// the refresh-token env trio is set. Returns undefined on any failure (the tools
// then degrade to not_configured). Never logs the token or client secret.
async function refreshAccessToken(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedRefreshToken && cachedRefreshToken.expiresAt > now) {
    return cachedRefreshToken.token;
  }

  const refreshToken =
    process.env.PA_GOOGLE_REFRESH_TOKEN || (await getSecret('PA_GOOGLE_REFRESH_TOKEN'));
  const clientId =
    process.env.PA_GOOGLE_CLIENT_ID || (await getSecret('PA_GOOGLE_CLIENT_ID'));
  const clientSecret =
    process.env.PA_GOOGLE_CLIENT_SECRET || (await getSecret('PA_GOOGLE_CLIENT_SECRET'));
  if (!refreshToken || !clientId || !clientSecret) return undefined;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return undefined;
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cachedRefreshToken = { token: json.access_token, expiresAt: now + Math.max(0, ttl - 60) * 1000 };
    return json.access_token;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the PA's Google access token, or undefined when Google isn't connected.
 * Precedence: env static token → Infisical static token → refresh-token exchange.
 * Never throws.
 */
export async function getGoogleAccessToken(): Promise<string | undefined> {
  const stat =
    process.env.PA_GOOGLE_ACCESS_TOKEN || (await getSecret(PA_GOOGLE_TOKEN_KEY)) || undefined;
  if (stat) return stat;
  return refreshAccessToken();
}

export type GoogleResult = { ok: boolean; status: number; body: any };

/**
 * Fetch a Google REST endpoint with the PA's Bearer token. JSON in/out; a 204
 * (or empty) response yields an empty body. Never throws — network errors come
 * back as { ok:false, status:0 }.
 */
export async function googleFetch(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<GoogleResult> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, body: { error: { message: e?.message ?? 'network error' } } };
  }
}

/** Extract a human error string from a Google API error body. */
export function googleError(r: GoogleResult): string {
  return r.body?.error?.message || r.body?.error?.errors?.[0]?.message || `Google API error (HTTP ${r.status})`;
}
