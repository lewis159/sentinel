// Lightweight liveness endpoint for the container healthcheck.
export const dynamic = 'force-dynamic';

export async function GET() {
  // TEMP DEBUG: node-runtime presence of the Clerk keys (booleans only, no values)
  return Response.json({
    ok: true,
    service: 'sentinel',
    node_sec: Boolean(process.env.CLERK_SECRET_KEY),
    node_enc: Boolean(process.env.CLERK_ENCRYPTION_KEY),
  });
}
