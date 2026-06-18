// Lightweight liveness endpoint for the container healthcheck.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, service: 'sentinel' });
}
