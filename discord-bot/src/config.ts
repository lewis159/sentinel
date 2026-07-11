// Bot configuration — env first, Infisical for secrets when bootstrapped.
//
// Non-secret config (guild id, channel ids, Sentinel base URL) comes from env.
// Secrets (DISCORD_BOT_TOKEN, OPS_BOT_TOKEN) resolve from Infisical when the
// INFISICAL_* bootstrap vars are present, falling back to env for local dev.
// Mirrors the REST pattern in the Sentinel app's lib/secrets.ts — no SDK.

const SITE_URL = (process.env.INFISICAL_SITE_URL || 'https://secrets.bentech.dev').replace(/\/+$/, '');
const CLIENT_ID = process.env.INFISICAL_CLIENT_ID;
const CLIENT_SECRET = process.env.INFISICAL_CLIENT_SECRET;
const PROJECT_ID = process.env.INFISICAL_PROJECT_ID;
const ENVIRONMENT = process.env.INFISICAL_ENVIRONMENT || 'prod';

function hasInfisical(): boolean {
  return Boolean(SITE_URL && CLIENT_ID && CLIENT_SECRET && PROJECT_ID);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function infisicalLogin(): Promise<string | undefined> {
  if (!hasInfisical()) return undefined;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;
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
    cachedToken = { token: json.accessToken, expiresAt: now + Math.max(0, expiresIn - 60) * 1000 };
    return cachedToken.token;
  } catch {
    return undefined;
  }
}

async function getInfisicalSecret(name: string): Promise<string | undefined> {
  const token = await infisicalLogin();
  if (!token) return undefined;
  try {
    const url =
      `${SITE_URL}/api/v3/secrets/raw/${encodeURIComponent(name)}` +
      `?workspaceId=${encodeURIComponent(PROJECT_ID as string)}` +
      `&environment=${encodeURIComponent(ENVIRONMENT)}&secretPath=%2F`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { secret?: { secretValue?: string } };
    return json.secret?.secretValue;
  } catch {
    return undefined;
  }
}

// Resolve a secret: env wins for local dev; else Infisical.
async function resolveSecret(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  return getInfisicalSecret(name);
}

export type Config = {
  discordToken: string;
  clientId: string;
  guildId: string;
  channels: {
    support: string | undefined;
    incidents: string | undefined;
    approvals: string | undefined;
    tickets: string | undefined;
    // The PA (Hermes Brain) conversation channel — messages here route to the PA.
    pa: string | undefined;
  };
  sentinelBase: string;
  botToken: string;
  pollIntervalMs: number;
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required config: ${name}`);
  return value;
}

// Load and validate all config. Throws with a clear message on the first missing
// required value so a misconfigured deploy fails fast at boot.
export async function loadConfig(): Promise<Config> {
  const [discordToken, botToken] = await Promise.all([
    resolveSecret('DISCORD_BOT_TOKEN'),
    resolveSecret('OPS_BOT_TOKEN'),
  ]);

  return {
    discordToken: required('DISCORD_BOT_TOKEN', discordToken),
    clientId: required('DISCORD_CLIENT_ID', process.env.DISCORD_CLIENT_ID),
    guildId: required('DISCORD_GUILD_ID', process.env.DISCORD_GUILD_ID),
    channels: {
      support: process.env.DISCORD_SUPPORT_CHANNEL_ID,
      incidents: process.env.DISCORD_INCIDENTS_CHANNEL_ID,
      approvals: process.env.DISCORD_APPROVALS_CHANNEL_ID,
      tickets: process.env.DISCORD_TICKETS_CHANNEL_ID,
      pa: process.env.DISCORD_PA_CHANNEL_ID,
    },
    sentinelBase: required('SENTINEL_API_BASE', process.env.SENTINEL_API_BASE).replace(/\/+$/, ''),
    botToken: required('OPS_BOT_TOKEN', botToken),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 15_000,
  };
}
