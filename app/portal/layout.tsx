import Link from 'next/link';
import './portal.css';
import { getPortalSession } from '@/lib/portal/auth';
import { PortalSignOut } from '@/components/portal/PortalSignOut';

export const dynamic = 'force-dynamic';

// The customer portal shell. The root layout renders {children} bare for /portal
// paths (signalled via x-sentinel-shell=portal from the middleware), so we supply
// our own header + nav here — deliberately NONE of the operator sidebar/topbar/
// command-palette.
//
// The layout is intentionally NON-gating: each portal PAGE calls
// requirePortalSession() itself (which redirects a tenant-less caller to
// /portal/no-access). Gating in the layout would redirect the /portal/no-access
// page — which lives under this same layout — into an infinite loop. Here we
// only READ the session (non-redirecting) to decorate the header, and hide the
// nav for a signed-in-but-tenant-less caller.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession();

  return (
    <div className="p-shell">
      <header className="p-header">
        <div className="p-brand">
          <span className="p-brand-mark" aria-hidden>S</span>
          <span>
            <div className="p-brand-name">Sentinel Support</div>
            <div className="p-brand-sub">Customer portal</div>
          </span>
        </div>

        {session && (
          <nav className="p-nav" aria-label="Portal">
            <Link href="/portal">My tickets</Link>
            <Link href="/portal/new">New request</Link>
          </nav>
        )}

        <div className="p-header-right">
          {session?.email && <span className="p-user">{session.email}</span>}
          <PortalSignOut />
        </div>
      </header>

      <main className="p-main">{children}</main>
    </div>
  );
}
