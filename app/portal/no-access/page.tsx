export const dynamic = 'force-dynamic';

// Shown to a signed-in caller who has NO active tenant/org. Deliberately a
// dead-end "contact us" state — never a redirect into the operator console, and
// never any ticket data (there is no tenant to scope to). This page is NOT gated
// by requirePortalSession (that would loop back here); it only ever renders text.
export default function PortalNoAccess() {
  return (
    <div>
      <div className="p-page-head">
        <h1 className="p-h1">No workspace access</h1>
        <div className="p-sub">Your account isn't linked to a customer workspace yet.</div>
      </div>

      <div className="p-empty">
        <div className="big">We couldn't find a workspace for your account</div>
        <div>
          If you believe this is a mistake, contact your account administrator or
          reach out to support and we'll get you set up.
        </div>
      </div>
    </div>
  );
}
