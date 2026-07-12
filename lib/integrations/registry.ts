// Third-party integration registry — the single config-driven source of truth
// for the Integrations admin page.
//
// Each entry declares:
//   - id / label / description  — identity + UI copy
//   - secretKeys                — the Infisical secret name(s) in `hermes/prod`
//                                 this integration maps to
//   - primaryKey                — the secret the "Set / rotate key" input writes,
//                                 and the one passed to test()
//   - flag?                     — the feature flag (env name) this integration
//                                 drives, if any (toggled via the runtime store)
//   - test?(key)                — a LIVE connection probe run SERVER-SIDE against
//                                 the currently-stored key. Omit to make an
//                                 integration untestable (e.g. Inngest keys have
//                                 no cheap ping).
//
// SECURITY: `test` receives the key value ONLY on the server (fetched from
// Infisical by the API route). It returns just { ok, detail } — it must NEVER put
// the key into `detail`, and must NEVER log it. Providers are hit with a short
// timeout; any network/parse error maps to { ok:false }.
//
// This module is PURE (no server-only import, no secret access) so it can be unit
// tested and imported from the registry-shape helpers freely. The actual key
// values are injected by the caller.

export type IntegrationTestResult = {
  ok: boolean;
  /** Short human detail for the UI. MUST NOT contain the key. */
  detail: string;
};

export type IntegrationTest = (key: string) => Promise<IntegrationTestResult>;

export type IntegrationDef = {
  id: string;
  label: string;
  description: string;
  /** Infisical secret name(s) in hermes/prod this integration maps to. */
  secretKeys: string[];
  /** The secret the Set-key input writes to and that test() is run against. */
  primaryKey: string;
  /** Feature flag (env var name) this integration drives, if any. */
  flag?: string;
  /** Live connection probe. Absent → integration is not testable. */
  test?: IntegrationTest;
  /** Optional provider docs link for the UI. */
  docsUrl?: string;
};

// --- Shared fetch helper ----------------------------------------------------
// Small wrapper so every test() has consistent timeout + error mapping and never
// throws. The key is only ever used to build the request headers here — it is
// never returned or logged.
async function ping(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// --- The registry -----------------------------------------------------------

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'LLM gateway powering the Hermes Brain — one key, any model.',
    secretKeys: ['OPENROUTER_API_KEY'],
    primaryKey: 'OPENROUTER_API_KEY',
    flag: 'HERMES_BRAIN_ENABLED',
    docsUrl: 'https://openrouter.ai/keys',
    test: async (key) => {
      try {
        const r = await ping('https://openrouter.ai/api/v1/key', {
          Authorization: `Bearer ${key}`,
        });
        if (!r.ok) {
          return { ok: false, detail: `HTTP ${r.status}${r.status === 401 ? ' — key rejected' : ''}` };
        }
        const d = r.body?.data ?? {};
        const label = d.label ? `key "${d.label}"` : 'key valid';
        const limit =
          typeof d.limit === 'number' ? ` · limit ${d.limit}` : d.limit === null ? ' · unlimited' : '';
        return { ok: true, detail: `${label}${limit}` };
      } catch {
        return { ok: false, detail: 'network error reaching openrouter.ai' };
      }
    },
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description: 'Payments + billing — the CFO/billing agent money path.',
    secretKeys: ['STRIPE_SECRET_KEY'],
    primaryKey: 'STRIPE_SECRET_KEY',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    test: async (key) => {
      try {
        const r = await ping('https://api.stripe.com/v1/balance', {
          Authorization: `Bearer ${key}`,
        });
        if (!r.ok) {
          const msg = r.body?.error?.message;
          return { ok: false, detail: `HTTP ${r.status}${msg ? ` — ${msg}` : ''}` };
        }
        const live = r.body?.livemode === true;
        const cur = Array.isArray(r.body?.available) && r.body.available[0]?.currency;
        return {
          ok: true,
          detail: `balance reachable · ${live ? 'live' : 'test'} mode${cur ? ` · ${String(cur).toUpperCase()}` : ''}`,
        };
      } catch {
        return { ok: false, detail: 'network error reaching api.stripe.com' };
      }
    },
  },
  {
    id: 'resend',
    label: 'Resend',
    description: 'Transactional + B2B email delivery.',
    secretKeys: ['RESEND_API'],
    primaryKey: 'RESEND_API',
    docsUrl: 'https://resend.com/api-keys',
    test: async (key) => {
      try {
        const r = await ping('https://api.resend.com/domains', {
          Authorization: `Bearer ${key}`,
        });
        if (!r.ok) {
          return { ok: false, detail: `HTTP ${r.status}${r.status === 401 ? ' — key rejected' : ''}` };
        }
        const n = Array.isArray(r.body?.data) ? r.body.data.length : undefined;
        return { ok: true, detail: `key valid${typeof n === 'number' ? ` · ${n} domain(s)` : ''}` };
      } catch {
        return { ok: false, detail: 'network error reaching api.resend.com' };
      }
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repo + CI access for the deploy / release agent.',
    secretKeys: ['HERMES_GITHUB_TOKEN'],
    primaryKey: 'HERMES_GITHUB_TOKEN',
    docsUrl: 'https://github.com/settings/tokens',
    test: async (key) => {
      try {
        const r = await ping('https://api.github.com/user', {
          Authorization: `Bearer ${key}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'sentinel-integrations',
        });
        if (!r.ok) {
          return { ok: false, detail: `HTTP ${r.status}${r.status === 401 ? ' — token rejected' : ''}` };
        }
        const login = r.body?.login;
        return { ok: true, detail: login ? `authenticated as ${login}` : 'token valid' };
      } catch {
        return { ok: false, detail: 'network error reaching api.github.com' };
      }
    },
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Bot surface for Hermes PA + support notifications.',
    secretKeys: ['DISCORD_BOT_TOKEN'],
    primaryKey: 'DISCORD_BOT_TOKEN',
    docsUrl: 'https://discord.com/developers/applications',
    test: async (key) => {
      try {
        const r = await ping('https://discord.com/api/v10/users/@me', {
          Authorization: `Bot ${key}`,
        });
        if (!r.ok) {
          return { ok: false, detail: `HTTP ${r.status}${r.status === 401 ? ' — token rejected' : ''}` };
        }
        const uname = r.body?.username;
        return { ok: true, detail: uname ? `bot @${uname}` : 'token valid' };
      } catch {
        return { ok: false, detail: 'network error reaching discord.com' };
      }
    },
  },
  {
    id: 'inngest',
    label: 'Inngest',
    description: 'Durable event/queue engine for background jobs.',
    secretKeys: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'],
    primaryKey: 'INNGEST_EVENT_KEY',
    flag: 'HERMES_INNGEST_ENABLED',
    docsUrl: 'https://app.inngest.com/env/production/manage/keys',
    // No cheap authenticated ping for Inngest keys → not testable (skipped).
  },
];

/** Look up an integration by id. */
export function getIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

/** True when the integration exposes a live connection test. */
export function isTestable(def: IntegrationDef): boolean {
  return typeof def.test === 'function';
}
