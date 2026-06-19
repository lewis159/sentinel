'use client';

import { SignOutButton, useUser } from '@clerk/nextjs';

export default function UnauthorizedPage() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <div className="placeholder">
      <div className="big">403</div>
      <div className="sub mb">
        {email
          ? `Signed in as ${email}, but this account doesn't have Sentinel access.`
          : "You're signed in, but this account doesn't have Sentinel access."}
      </div>
      <SignOutButton redirectUrl="/sign-in">
        <button className="btn">Sign out &amp; use another account</button>
      </SignOutButton>
    </div>
  );
}
