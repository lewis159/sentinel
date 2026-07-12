import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the CI test-suite trigger (lib/smoke/ci.ts), which backs the
// admin Testing hub's "Run CI suite" section. We mock global fetch + getSecret so
// no network is hit, and prove:
//   • not_configured — no token → clean not_configured result, fetch NEVER called.
//   • dispatch parse — token present → correct dispatch URL/body/headers, ok:true.
//   • runs parse     — token present → workflow_runs mapped to the CiRun shape.
//   • workflow_not_found — a 404 maps to the friendly "not merged yet" state.
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));
vi.mock('@/lib/secrets', () => ({ getSecret: vi.fn(async () => undefined) }));

import { dispatchCiWorkflow, listCiRuns } from '@/lib/smoke/ci';

function mockFetch(response: { ok?: boolean; status?: number; body?: any }) {
  const fn = vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal('fetch', fn as any);
  return fn;
}

beforeEach(() => {
  delete process.env.HERMES_GITHUB_TOKEN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('dispatchCiWorkflow', () => {
  it('no token → not_configured, and does NOT call fetch', async () => {
    const fetchFn = mockFetch({});
    const res = await dispatchCiWorkflow(null); // explicit null token
    expect(res.ok).toBe(false);
    expect((res as any).error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('with a token → POSTs a workflow_dispatch on main with a Bearer header', async () => {
    const fetchFn = mockFetch({ ok: true, status: 204, body: {} });
    const res = await dispatchCiWorkflow('ghp_test');
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.github.com/repos/lewis159/sentinel/actions/workflows/test.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ghp_test');
    expect(JSON.parse(init.body).ref).toBe('main');
  });

  it('a 404 → workflow_not_found (friendly "not merged yet")', async () => {
    mockFetch({ ok: false, status: 404, body: {} });
    const res = await dispatchCiWorkflow('ghp_test');
    expect(res.ok).toBe(false);
    expect((res as any).error).toBe('workflow_not_found');
  });

  it('reads the token from HERMES_GITHUB_TOKEN when none is passed', async () => {
    process.env.HERMES_GITHUB_TOKEN = 'ghp_env';
    const fetchFn = mockFetch({ ok: true, status: 204, body: {} });
    const res = await dispatchCiWorkflow();
    expect(res.ok).toBe(true);
    const [, init] = fetchFn.mock.calls[0] as [string, any];
    expect(init.headers.Authorization).toBe('Bearer ghp_env');
  });
});

describe('listCiRuns', () => {
  it('no token → not_configured with empty runs, no fetch', async () => {
    const fetchFn = mockFetch({});
    const res = await listCiRuns(null);
    expect(res.ok).toBe(false);
    expect((res as any).error).toBe('not_configured');
    expect(res.runs).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('with a token → GETs runs and maps them to the CiRun shape', async () => {
    const fetchFn = mockFetch({
      body: {
        workflow_runs: [
          {
            id: 42,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-07-12T10:00:00Z',
            html_url: 'https://github.com/lewis159/sentinel/actions/runs/42',
            head_branch: 'main',
            name: 'CI',
          },
        ],
      },
    });
    const res = await listCiRuns('ghp_test');
    expect(res.ok).toBe(true);
    const [url] = fetchFn.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.github.com/repos/lewis159/sentinel/actions/workflows/test.yml/runs?per_page=5');
    expect(res.runs).toEqual([
      {
        id: 42,
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-07-12T10:00:00Z',
        url: 'https://github.com/lewis159/sentinel/actions/runs/42',
        branch: 'main',
        name: 'CI',
      },
    ]);
  });

  it('a 404 → workflow_not_found with empty runs', async () => {
    mockFetch({ ok: false, status: 404, body: {} });
    const res = await listCiRuns('ghp_test');
    expect(res.ok).toBe(false);
    expect((res as any).error).toBe('workflow_not_found');
    expect(res.runs).toEqual([]);
  });
});
