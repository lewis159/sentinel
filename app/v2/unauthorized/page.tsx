import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionAccess, resolveSections } from '@/lib/auth';
import type { Section } from '@/lib/v2/rbac';

export const dynamic = 'force-dynamic';

// Sentinel v2 — "no access to this section" landing. Renders inside the v2
// shell (this route lives under /v2, so the v2 layout wraps it). We do NOT gate
// this page by section — any signed-in user may see it — we only require sign-in
// so unauthenticated visitors are bounced to the sign-in flow.

const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  support: 'Support',
  operations: 'Operations',
  security: 'Security',
  admin: 'Admin',
  hermes: 'Hermes',
};

export default async function V2UnauthorizedPage() {
  const { userId, role, sections } = await getSessionAccess();

  if (!userId) {
    redirect('/sign-in');
  }

  const granted = resolveSections(role, sections);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '6vh',
      }}
    >
      <div
        className="v2-card"
        style={{ maxWidth: 460, width: '100%', padding: '28px 26px', textAlign: 'center' }}
      >
        <div className="v2-eyebrow">Access denied</div>
        <h1 className="v2-h1" style={{ marginTop: 6 }}>
          No access to this section
        </h1>
        <div className="v2-sub" style={{ marginTop: 10 }}>
          Your account doesn&apos;t have permission to view this section. You currently
          have access to:
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            margin: '16px 0 22px',
          }}
        >
          {granted.map((s) => (
            <span key={s} className="v2-pill info">
              {SECTION_LABELS[s]}
            </span>
          ))}
        </div>

        <Link className="v2-btn" href="/v2" style={{ justifyContent: 'center' }}>
          Go to Overview
        </Link>
      </div>
    </div>
  );
}
