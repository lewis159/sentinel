// getDeployStatus — reads the latest GitHub Actions runs + open PRs for the
// estate repos so the PA watchdog can say "build X failed on main" / "PR #24 has
// been open 3 days". Read-only → autonomy 'auto'.
//
// Uses a GitHub token from env (GITHUB_TOKEN / GH_TOKEN) or Infisical. When no
// token / repos are configured it returns a clear "not configured" result so the
// tool is a swappable stub — the watchdog degrades gracefully rather than lying.
//
//   GITHUB_TOKEN            — a PAT with `repo`/`actions:read` scope.
//   ESTATE_REPOS            — comma-separated "owner/repo" list to watch.
import 'server-only';
import { z } from 'zod';
import { getSecret } from '@/lib/secrets';
import type { BrainTool } from './types';

const schema = z.object({
  repo: z
    .string()
    .optional()
    .describe('A single "owner/repo" to check. Omit to check all configured estate repos.'),
});

async function ghToken(): Promise<string | undefined> {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (await getSecret('GITHUB_TOKEN')) ||
    undefined
  );
}

function estateRepos(): string[] {
  return (process.env.ESTATE_REPOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function gh<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type RepoStatus = {
  repo: string;
  latestRun?: { name: string; branch: string; status: string; conclusion: string | null; url: string };
  openPRs: { number: number; title: string; ageDays: number; url: string }[];
  error?: string;
};

async function statusFor(repo: string, token: string): Promise<RepoStatus> {
  const runs = await gh<any>(`/repos/${repo}/actions/runs?per_page=1`, token);
  const prs = await gh<any[]>(`/repos/${repo}/pulls?state=open&per_page=20`, token);
  const out: RepoStatus = { repo, openPRs: [] };
  const run = runs?.workflow_runs?.[0];
  if (run) {
    out.latestRun = {
      name: run.name ?? run.display_title ?? 'workflow',
      branch: run.head_branch ?? '?',
      status: run.status ?? '?',
      conclusion: run.conclusion ?? null,
      url: run.html_url ?? '',
    };
  }
  if (Array.isArray(prs)) {
    out.openPRs = prs.map((p) => ({
      number: p.number,
      title: p.title,
      ageDays: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000),
      url: p.html_url ?? '',
    }));
  }
  return out;
}

function summarize(rows: RepoStatus[]): string {
  const parts: string[] = [];
  for (const r of rows) {
    if (r.latestRun) {
      const state =
        r.latestRun.status === 'completed'
          ? r.latestRun.conclusion ?? 'completed'
          : r.latestRun.status;
      parts.push(`${r.repo}: ${r.latestRun.name} on ${r.latestRun.branch} → ${state}`);
    }
    const stale = r.openPRs.filter((p) => p.ageDays >= 2);
    if (stale.length) {
      parts.push(
        `${r.repo}: ${stale.length} PR(s) open ≥2d: ${stale
          .map((p) => `#${p.number} (${p.ageDays}d)`)
          .join(', ')}`,
      );
    }
  }
  return parts.length ? parts.join('\n') : 'No workflow runs or open PRs found.';
}

export const getDeployStatusTool: BrainTool<z.infer<typeof schema>> = {
  name: 'getDeployStatus',
  description:
    'Read the latest GitHub Actions run and open PRs for the estate repos. Use to answer "is main green" / "any failed builds" / "any stale PRs".',
  schema,
  autonomy: 'auto',
  run: async ({ repo }) => {
    const token = await ghToken();
    if (!token) {
      return {
        ok: false,
        summary:
          'Deploy status not configured — set GITHUB_TOKEN (and ESTATE_REPOS) to enable live CI/PR checks.',
        error: 'not_configured',
      };
    }
    const repos = repo ? [repo] : estateRepos();
    if (repos.length === 0) {
      return {
        ok: false,
        summary:
          'No repos configured — set ESTATE_REPOS="owner/repo,owner/repo2" or pass a repo argument.',
        error: 'not_configured',
      };
    }
    const rows = await Promise.all(repos.map((r) => statusFor(r, token)));
    return { ok: true, summary: summarize(rows), data: rows };
  },
};
