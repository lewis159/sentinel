import './v2.css';
import SidebarV2 from '@/components/v2/SidebarV2';
import TopBarV2 from '@/components/v2/TopBarV2';
import RefreshProvider from '@/components/v2/RefreshProvider';
import RefreshFooter from '@/components/v2/RefreshFooter';
import { e2eBypass, getSessionAccess, resolveSections } from '@/lib/auth';
import type { Section } from '@/lib/v2/rbac';

// v2 shell. The root layout renders {children} bare for /v2 paths (signalled via
// the x-sentinel-shell header), so v2 supplies its own sidebar + topbar here.
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  // TEST-ONLY (double-gated, see e2eBypass): the rail normally resolves RBAC on
  // the client via Clerk's useUser(). Under the E2E shim there is no Clerk
  // session, so resolve granted sections server-side (from the synthetic
  // identity / x-e2e-* headers) and hand them to the rail. `undefined` in prod →
  // the rail keeps its existing client-side behavior, unchanged.
  let grantedOverride: Section[] | undefined;
  if (e2eBypass()) {
    const { role, sections } = await getSessionAccess();
    grantedOverride = resolveSections(role, sections);
  }

  return (
    <RefreshProvider>
      <div className="v2-shell">
        <SidebarV2 grantedOverride={grantedOverride} />
        <div className="v2-main">
          <TopBarV2 />
          <main className="v2-content">{children}</main>
          <RefreshFooter />
        </div>
      </div>
    </RefreshProvider>
  );
}
