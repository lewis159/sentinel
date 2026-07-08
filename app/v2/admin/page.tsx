import './admin.css';
import { clerkClient } from '@clerk/nextjs/server';
import { requireGlobalAdminPage } from '@/lib/auth';
import AccessEditor from '@/components/v2/AccessEditor';

export const dynamic = 'force-dynamic';

// ADMIN · Access — a REAL editor of staff section-grants (RBAC), backed by
// Clerk. Only global admins can open this page. Each staff member's role
// (publicMetadata.role) maps to a set of rail SECTIONS; an optional per-user
// override (publicMetadata.sections) tweaks the effective set. The client
// <AccessEditor> lets you change a role or toggle individual section grants and
// saves back to Clerk via POST /api/v2/access.

type MappedUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
  sections?: string[];
};

async function loadStaff(): Promise<MappedUser[]> {
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ limit: 100 });

    return list.data.map((u) => {
      const email = u.primaryEmailAddress?.emailAddress ?? '';
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      const pub = u.publicMetadata as
        | { role?: unknown; sections?: unknown }
        | undefined;

      return {
        id: u.id,
        name: fullName || email || u.id,
        email,
        role: typeof pub?.role === 'string' ? pub.role : undefined,
        sections: Array.isArray(pub?.sections)
          ? pub.sections.filter((s): s is string => typeof s === 'string')
          : undefined,
      };
    });
  } catch {
    // Never 500 the page if Clerk is unreachable / misconfigured.
    return [];
  }
}

export default async function V2AdminAccessPage() {
  await requireGlobalAdminPage();

  const users = await loadStaff();

  return (
    <div>
      {/* Header */}
      <div className="spread v2-adm-head">
        <div>
          <div className="v2-eyebrow">Admin · Access</div>
          <h1 className="v2-h1">Staff &amp; permissions</h1>
          <div className="v2-sub">
            {users.length} staff · roles → sections, per-user overrides
          </div>
        </div>
      </div>

      <AccessEditor users={users} />
    </div>
  );
}
