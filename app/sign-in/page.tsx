import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div style={{ maxWidth: 400, margin: '0 auto', marginTop: 90 }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div className="h1" style={{ marginBottom: 4 }}>Sentinel</div>
        <div className="sub">Sign in to continue</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SignIn />
      </div>

      <div className="sub mt" style={{ textAlign: 'center' }}>
        Invite-only — no public sign-up
      </div>
    </div>
  );
}
