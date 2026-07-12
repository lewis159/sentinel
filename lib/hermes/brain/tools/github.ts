// GitHub action tools for the Brain — the CTO exec persona's deploy / repo path.
//
//   listWorkflowRuns (auto)  — read recent GitHub Actions runs for a repo.
//   getFileContents  (auto)  — read a file from a repo (safe lookup).
//   triggerWorkflow  (GATED) — dispatch a workflow (i.e. kick a deploy).
//   commitFile       (GATED) — create/update a file in a repo (a real commit).
//
// GATED tools cause a deploy or change repo contents, so they only run AFTER a
// human approves the proposal in the Sentinel Approvals queue — the graph
// interrupts on gated tools and the generic resume path calls run() exactly once.
// There is NO auto-deploy / auto-commit path here.
//
// Config: the GitHub token is read from the env var named exactly
// `HERMES_GITHUB_TOKEN` (a PAT / fine-grained token with actions:write +
// contents:write for the target repos). We also try Infisical
// getSecret('HERMES_GITHUB_TOKEN') as a fallback. The token is NEVER hardcoded and
// NEVER logged. Missing token → a clear "not configured" result (never an unhandled
// throw). Note: this is separate from getDeployStatus's read-only GITHUB_TOKEN — the
// action tools want a distinct, higher-scoped token.
import 'server-only';
import { z } from 'zod';
import { getSecret } from '@/lib/secrets';
import type { BrainTool } from './types';

const GH_API = 'https://api.github.com';

// HERMES_GITHUB_TOKEN (exact name): env first, then Infisical fallback.
async function ghToken(): Promise<string | undefined> {
  return process.env.HERMES_GITHUB_TOKEN || (await getSecret('HERMES_GITHUB_TOKEN')) || undefined;
}

const NOT_CONFIGURED =
  'GitHub not configured — set the HERMES_GITHUB_TOKEN env var (a PAT with actions:write + contents:write) to enable deploys/commits.';

type GhResult = { ok: boolean; status: number; body: any };

async function ghFetch(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<GhResult> {
  const res = await fetch(`${GH_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  // Some write endpoints (dispatches) return 204 with no body.
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function ghError(r: GhResult): string {
  return r.body?.message || `GitHub API error (HTTP ${r.status})`;
}

// ---------- listWorkflowRuns (auto / read) ----------
const listRunsSchema = z.object({
  repo: z.string().describe('The "owner/repo" to inspect, e.g. lewis159/youtube-transcriber.'),
  limit: z.number().int().min(1).max(20).optional().describe('Max runs to return (default 5).'),
});

export const listWorkflowRunsTool: BrainTool<z.infer<typeof listRunsSchema>> = {
  name: 'listWorkflowRuns',
  description:
    'Read recent GitHub Actions workflow runs for a repo (name, branch, status, conclusion, url). Safe read — use before deciding to re-run or trigger a deploy.',
  schema: listRunsSchema,
  autonomy: 'auto',
  run: async ({ repo, limit }) => {
    const token = await ghToken();
    if (!token) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const per = limit ?? 5;
    const r = await ghFetch(`/repos/${repo}/actions/runs?per_page=${per}`, token);
    if (!r.ok) return { ok: false, summary: `Could not read runs for ${repo}: ${ghError(r)}`, error: 'github_error' };
    const runs = (r.body?.workflow_runs ?? []).slice(0, per).map((run: any) => ({
      id: run.id,
      name: run.name ?? run.display_title ?? 'workflow',
      branch: run.head_branch,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
    }));
    if (runs.length === 0) return { ok: true, summary: `No workflow runs found for ${repo}.`, data: [] };
    const lines = runs
      .map((run: any) => `${run.name} on ${run.branch} → ${run.status === 'completed' ? run.conclusion : run.status}`)
      .join('\n');
    return { ok: true, summary: `${runs.length} run(s) for ${repo}:\n${lines}`, data: runs };
  },
};

// ---------- getFileContents (auto / read) ----------
const getFileSchema = z.object({
  repo: z.string().describe('The "owner/repo", e.g. lewis159/youtube-transcriber.'),
  path: z.string().describe('The file path within the repo, e.g. package.json or infra/docker-compose.yml.'),
  ref: z.string().optional().describe('Branch, tag, or commit SHA. Omit for the default branch.'),
});

export const getFileContentsTool: BrainTool<z.infer<typeof getFileSchema>> = {
  name: 'getFileContents',
  description:
    'Read the contents of a file in a repo at an optional ref. Safe read — returns the decoded text plus the blob sha (needed to update the file later).',
  schema: getFileSchema,
  autonomy: 'auto',
  run: async ({ repo, path, ref }) => {
    const token = await ghToken();
    if (!token) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const r = await ghFetch(`/repos/${repo}/contents/${path}${qs}`, token);
    if (!r.ok) return { ok: false, summary: `Could not read ${repo}/${path}: ${ghError(r)}`, error: 'github_error' };
    const f = r.body;
    const content =
      f?.encoding === 'base64' && typeof f.content === 'string'
        ? Buffer.from(f.content, 'base64').toString('utf8')
        : undefined;
    return {
      ok: true,
      summary: `${repo}/${path}${ref ? `@${ref}` : ''} — ${f?.size ?? '?'} bytes (sha ${f?.sha ?? '?'}).`,
      data: { path: f?.path, sha: f?.sha, size: f?.size, content },
    };
  },
};

// ---------- triggerWorkflow (GATED / deploy) ----------
const triggerSchema = z.object({
  repo: z.string().describe('The "owner/repo" that owns the workflow.'),
  workflowId: z
    .string()
    .describe('The workflow file name (e.g. deploy.yml) or its numeric id.'),
  ref: z.string().describe('The git ref to run the workflow against, e.g. main.'),
  inputs: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional workflow_dispatch inputs (string→string).'),
});
export type TriggerWorkflowArgs = z.infer<typeof triggerSchema>;

export const triggerWorkflowTool: BrainTool<TriggerWorkflowArgs> = {
  name: 'triggerWorkflow',
  description:
    'Dispatch a GitHub Actions workflow on a ref (i.e. kick a deploy/CI job). This can ship code or change infrastructure, so it requires human approval before it runs.',
  schema: triggerSchema,
  autonomy: 'gated',
  describeCall: (a) => `Trigger workflow ${a.workflowId} on ${a.repo}@${a.ref}`,
  run: async ({ repo, workflowId, ref, inputs }) => {
    const token = await ghToken();
    if (!token) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const body: Record<string, unknown> = { ref };
    if (inputs && Object.keys(inputs).length) body.inputs = inputs;
    const r = await ghFetch(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      token,
      { method: 'POST', body },
    );
    if (!r.ok) return { ok: false, summary: `Workflow dispatch failed: ${ghError(r)}`, error: 'github_error' };
    return {
      ok: true,
      summary: `Dispatched ${workflowId} on ${repo}@${ref}.`,
      data: { repo, workflowId, ref, inputs: inputs ?? {} },
    };
  },
};

// ---------- commitFile (GATED / repo write) ----------
const commitSchema = z.object({
  repo: z.string().describe('The "owner/repo" to commit to.'),
  path: z.string().describe('The file path to create or update, e.g. config/roadmap.json.'),
  content: z.string().describe('The new file contents (plain UTF-8 text; base64-encoded for the API automatically).'),
  message: z.string().describe('The commit message.'),
  branch: z.string().optional().describe('Branch to commit on. Omit for the default branch.'),
  sha: z
    .string()
    .optional()
    .describe('The blob sha of the file being REPLACED (from getFileContents). Omit when creating a new file.'),
});
export type CommitFileArgs = z.infer<typeof commitSchema>;

export const commitFileTool: BrainTool<CommitFileArgs> = {
  name: 'commitFile',
  description:
    'Create or update a file in a repo via a commit (e.g. a roadmap/config change). This writes to the repo, so it requires human approval before it runs. To UPDATE an existing file, pass its current sha (from getFileContents).',
  schema: commitSchema,
  autonomy: 'gated',
  describeCall: (a) =>
    `Commit ${a.repo}/${a.path}${a.branch ? `@${a.branch}` : ''}: "${a.message.slice(0, 60)}"${a.sha ? ' (update)' : ' (create)'}`,
  run: async ({ repo, path, content, message, branch, sha }) => {
    const token = await ghToken();
    if (!token) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
    };
    if (branch) body.branch = branch;
    if (sha) body.sha = sha;
    const r = await ghFetch(`/repos/${repo}/contents/${path}`, token, { method: 'PUT', body });
    if (!r.ok) return { ok: false, summary: `Commit failed: ${ghError(r)}`, error: 'github_error' };
    const commitSha = r.body?.commit?.sha;
    return {
      ok: true,
      summary: `Committed ${repo}/${path}${branch ? `@${branch}` : ''} — ${commitSha ?? 'ok'}.`,
      data: { repo, path, branch, commitSha, contentSha: r.body?.content?.sha },
    };
  },
};
