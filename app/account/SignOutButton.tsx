'use client';

import { SignOutButton } from '@clerk/nextjs';

// Real Clerk sign-out, styled as the account-page "Sign out" button.
export default function AccountSignOut() {
  return (
    <SignOutButton redirectUrl="/sign-in">
      <button className="btn ghost">Sign out</button>
    </SignOutButton>
  );
}
