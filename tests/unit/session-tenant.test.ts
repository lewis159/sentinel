import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// getSessionTenant (lib/auth.ts) turns Clerk org context into the tenant scope
// passed to getTicketsByKind. We drive the REAL Clerk path (not the E2E header
// bypass) by mocking '@clerk/nextjs/server'. auth() is consulted twice — once
// in getSessionTenant for { userId, orgId }, once inside getSessionRole for
// { userId, sessionClaims } — so the mock returns all fields on every call.
// ---------------------------------------------------------------------------

// Hoisted so the (hoisted) vi.mock factories can close over the spies.
const H = vi.hoisted(() => {
  const box: { authReturn: any } = {
    authReturn: { userId: null, orgId: null, sessionClaims: null },
  };
  const auth = vi.fn(async () => box.authReturn);
  const clerkClient = vi.fn(async () => ({
    users: { getUser: vi.fn(async () => ({ publicMetadata: {} })) },
  }));
  return { box, auth, clerkClient };
});
const { auth } = H;

vi.mock('@clerk/nextjs/server', () => ({ auth: H.auth, clerkClient: H.clerkClient }));
// next/headers is only touched by the E2E bypass, which stays OFF here; stub it
// so importing lib/auth.ts never pulls the real (request-scoped) module.
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Map()) }));

import { getSessionTenant } from '@/lib/auth';

const withRole = (role: unknown, extra: Record<string, any> = {}) => ({
  userId: 'user_1',
  orgId: null,
  sessionClaims: { publicMetadata: { role } },
  ...extra,
});

beforeEach(() => {
  // Ensure the double-gated E2E bypass is inert for these tests.
  delete process.env.E2E_TEST_MODE;
  auth.mockClear();
  H.box.authReturn = { userId: null, orgId: null, sessionClaims: null };
});

describe('getSessionTenant', () => {
  it('global_admin → operator, unscoped (tenantRef null)', async () => {
    H.box.authReturn = withRole('global_admin', { orgId: 'org_ignored' });
    const t = await getSessionTenant();
    expect(t).toEqual({ tenantRef: null, isOperator: true });
  });

  it('normal org member → scoped to their org id, not an operator', async () => {
    H.box.authReturn = withRole('member', { orgId: 'org_acme' });
    const t = await getSessionTenant();
    expect(t).toEqual({ tenantRef: 'org_acme', isOperator: false });
  });

  it('signed-in member with no active org → tenantRef null, still not an operator', async () => {
    H.box.authReturn = withRole('member', { orgId: null });
    const t = await getSessionTenant();
    expect(t).toEqual({ tenantRef: null, isOperator: false });
  });

  it('not signed in → tenantRef null, not an operator', async () => {
    H.box.authReturn = { userId: null, orgId: null, sessionClaims: null };
    const t = await getSessionTenant();
    expect(t).toEqual({ tenantRef: null, isOperator: false });
  });
});
