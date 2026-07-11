// Feature flag for the Hermes Brain (P0). Everything the Brain adds is behind
// this flag so the existing Sentinel app is completely unaffected when it's off.
//
//   HERMES_BRAIN_ENABLED=1|true|yes  → Brain routes/tools are live.
//   unset / anything else            → /api/hermes/pa/chat + the resume-and-execute
//                                       path short-circuit to a disabled response,
//                                       and approve/deny fall back to the legacy
//                                       "post draft as comment" behaviour.

export function brainEnabled(): boolean {
  const v = (process.env.HERMES_BRAIN_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
