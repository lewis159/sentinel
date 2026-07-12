// CI test-suite trigger — dispatches the `test.yml` GitHub Actions workflow on
// lewis159/sentinel and reads its recent runs, via the GitHub REST API.
//
// The unit/integration/e2e suite runs in CI (not in the app process), so the admin
// Testing hub's "CI suite" section TRIGGERS that workflow and shows its status
// rather than running anything locally. This is prod-safe: a workflow_dispatch only
// kicks CI — it performs no destructive local action.
//
// Auth: the token is read from HERMES_GITHUB_TOKEN (env first, then Infisical) — the
// same key the Brain's github action-tool uses. Missing token → a clean
// `not_configured` result, NEVER a throw. A 404 from the dispatch/runs endpoint (the
// workflow file not merged yet) → a friendly `workflow_not_found` result.
import 'server-only';
import { getSecret } from '@/lib/secrets';

const REPO = 'lewis159/sentinel';
const WORKFLOW = 'test.yml';
const GH_API = 'https://api.github.com';

export type CiDispatchResult =
  | { ok: true; dispatched: true }
  | { ok: false; error: 'not_configured' | 'workflow_not_found' | 'github_error'; message: string; status?: number };

export type CiRun = {
  id: number;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null (while running)
  createdAt: string | null;
  url: string | null;
  branch: string | null;
  name: string | null;
};

export type CiRunsResult =
  | { ok: true; runs: CiRun[] }
  | { ok: false; error: 'not_configured' | 'workflow_not_found' | 'github_error'; message: string; runs: CiRun[]; status?: number };

// HERMES_GITHUB_TOKEN: env first, then Infisical fallback (mirrors the github tool).
export async function ciToken(): Promise<string | undefined> {
  return process.env.HERMES_GITHUB_TOKEN || (await getSecret('HERMES_GITHUB_TOKEN')) || undefined;
}

const NOT_CONFIGURED_MSG =
  'CI trigger not configured — set the HERMES_GITHUB_TOKEN env var (a PAT with actions:write on lewis159/sentinel).';
const WORKFLOW_NOT_FOUND_MSG =
  'CI workflow not merged yet — test.yml is not present on lewis159/sentinel@main.';

function ghHeaders(token: string, withBody = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(withBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

// Dispatch test.yml on main. Injectable `token` (defaults to ciToken()) keeps this
// unit-testable. Never throws — network errors map to `github_error`.
export async function dispatchCiWorkflow(token?: string | null): Promise<CiDispatchResult> {
  const t = token === undefined ? await ciToken() : token;
  if (!t) return { ok: false, error: 'not_configured', message: NOT_CONFIGURED_MSG };

  try {
    const res = await fetch(
      `${GH_API}/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      { method: 'POST', headers: ghHeaders(t, true), body: JSON.stringify({ ref: 'main' }) },
    );
    if (res.status === 404) {
      return { ok: false, error: 'workflow_not_found', message: WORKFLOW_NOT_FOUND_MSG, status: 404 };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      const msg = (body as any)?.message || `GitHub API error (HTTP ${res.status})`;
      return { ok: false, error: 'github_error', message: `Dispatch failed: ${msg}`, status: res.status };
    }
    return { ok: true, dispatched: true };
  } catch (e: any) {
    return { ok: false, error: 'github_error', message: `Dispatch failed: ${e?.message ?? 'network error'}` };
  }
}

function mapRun(r: any): CiRun {
  return {
    id: Number(r?.id),
    status: r?.status ?? null,
    conclusion: r?.conclusion ?? null,
    createdAt: r?.created_at ?? null,
    url: r?.html_url ?? null,
    branch: r?.head_branch ?? null,
    name: r?.name ?? r?.display_title ?? null,
  };
}

// List the most recent test.yml runs. Injectable `token` for unit tests. Never
// throws — errors map to a result with an empty runs array.
export async function listCiRuns(token?: string | null, per = 5): Promise<CiRunsResult> {
  const t = token === undefined ? await ciToken() : token;
  if (!t) return { ok: false, error: 'not_configured', message: NOT_CONFIGURED_MSG, runs: [] };

  try {
    const res = await fetch(
      `${GH_API}/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=${per}`,
      { headers: ghHeaders(t) },
    );
    if (res.status === 404) {
      return { ok: false, error: 'workflow_not_found', message: WORKFLOW_NOT_FOUND_MSG, runs: [], status: 404 };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      const msg = (body as any)?.message || `GitHub API error (HTTP ${res.status})`;
      return { ok: false, error: 'github_error', message: `Could not read runs: ${msg}`, runs: [], status: res.status };
    }
    const body = await res.json().catch(() => ({} as any));
    const runs = Array.isArray((body as any)?.workflow_runs)
      ? (body as any).workflow_runs.slice(0, per).map(mapRun)
      : [];
    return { ok: true, runs };
  } catch (e: any) {
    return { ok: false, error: 'github_error', message: `Could not read runs: ${e?.message ?? 'network error'}`, runs: [] };
  }
}
