// Posture-report endpoint. PDF generation needs headless Chrome, which is NOT
// present in the Next.js app image — it runs as an operator/CI step via
// `node scripts/build-posture-pdf.js`. So this route returns a clear message
// (HTTP 200) rather than a 404, so the "Generate PDF" button explains itself.
//
// Future: a worker job or a Chrome-enabled sidecar could render on-demand and
// stream the resulting PDF back from here.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: false,
    note: 'Run `node scripts/build-posture-pdf.js` — PDF generation runs as an operator/CI script, not in the app container.',
  });
}
