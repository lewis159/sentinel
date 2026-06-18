export default function SignInPage() {
  return (
    <div style={{ maxWidth: 360, margin: '0 auto', marginTop: 90 }}>
      <div className="card">
        <div style={{ textAlign: 'center' }}>
          <div className="h1" style={{ marginBottom: 4 }}>Sentinel</div>
          <div className="sub mb">Sign in to continue</div>
        </div>

        <div className="mb">
          <div className="k2" style={{ marginBottom: 6 }}>Email</div>
          <div className="search" style={{ width: '100%' }}>you@company.com</div>
        </div>

        <button className="btn" style={{ width: '100%', justifyContent: 'center' }}>Continue with Clerk</button>

        <div className="sub mt" style={{ textAlign: 'center' }}>Invite-only — no public sign-up</div>
      </div>
    </div>
  );
}
