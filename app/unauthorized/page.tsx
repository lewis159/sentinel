import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="placeholder">
      <div className="big">403</div>
      <div className="sub mb">You&apos;re signed in but don&apos;t have access to Sentinel.</div>
      <Link className="link" href="/">← Back to overview</Link>
    </div>
  );
}
