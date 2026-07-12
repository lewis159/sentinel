import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Inngest } from 'inngest';

// ---------------------------------------------------------------------------
// Serve endpoint gating (app/api/inngest/route.ts).
//
// Proves the flag contract WITHOUT a real Inngest server:
//   • HERMES_INNGEST_ENABLED off → every method returns 503 (the server can't
//     sync or invoke anything, so the app is unaffected before the server exists).
//   • HERMES_INNGEST_ENABLED on  → the SDK `serve` handler responds (not 503).
//
// We mock the client + functions modules so importing the route never pulls in
// server-only/DB/graph code — this isolates the route's own gating logic.
// ---------------------------------------------------------------------------

// A real (dev-mode) Inngest client so the SDK serve handler answers GET locally
// without needing a signing key / cloud handshake.
const devClient = new Inngest({ id: 'sentinel-test', isDev: true });

vi.mock('@/lib/inngest/client', () => ({
  inngest: devClient,
  inngestEnabled: () =>
    ['1', 'true', 'yes', 'on'].includes((process.env.HERMES_INNGEST_ENABLED ?? '').toLowerCase()),
}));
vi.mock('@/lib/inngest/functions', () => ({ functions: [] }));

beforeEach(() => {
  vi.resetModules();
  delete process.env.HERMES_INNGEST_ENABLED;
});

describe('Inngest serve route — flag gating', () => {
  it('NO-OPs with 503 when HERMES_INNGEST_ENABLED is off', async () => {
    delete process.env.HERMES_INNGEST_ENABLED;
    const route = await import('@/app/api/inngest/route');
    for (const method of ['GET', 'POST', 'PUT'] as const) {
      const res = await (route as any)[method](new Request('http://localhost/api/inngest'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.disabled).toBe(true);
    }
  });

  it('serves (not 503) when HERMES_INNGEST_ENABLED is on', async () => {
    process.env.HERMES_INNGEST_ENABLED = '1';
    const route = await import('@/app/api/inngest/route');
    const res = await (route as any).GET(new Request('http://localhost/api/inngest'));
    expect(res.status).not.toBe(503);
  });
});
