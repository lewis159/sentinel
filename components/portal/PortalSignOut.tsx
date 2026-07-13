'use client';

import { SignOutButton } from '@clerk/nextjs';

// Sign-out control for the portal header. Sends the customer back to sign-in,
// never into the operator console.
export function PortalSignOut() {
  return (
    <SignOutButton redirectUrl="/sign-in">
      <button type="button" className="p-btn ghost">Sign out</button>
    </SignOutButton>
  );
}
