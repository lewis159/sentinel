import '../access.css';
import { requireSectionPage } from '@/lib/auth';
import { listOrgs } from '@/lib/access';

export const dynamic = 'force-dynamic';

// ADMIN · Access → Organizations. READ-ONLY mirror of Clerk Organizations and
// their members, via lib/access.ts listOrgs() (Clerk-first, degrades to a mock /
// empty state when Clerk is unavailable or there are no orgs). Phase 1 is
// display-only: ops.orgs / ops.org_members are written by a future reconcile,
// not by this view. global_admin only.

// Two-letter monogram for a member avatar from their label (email or name).
function monogram(label: string): string {
  const at = label.indexOf('@');
  const base = at > 0 ? label.slice(0, at) : label;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

const ADMIN_ROLES = new Set(['admin', 'org:admin']);

export default async function V2OrgsAccessPage() {
  await requireSectionPage('admin');

  const { rows: orgs } = await listOrgs();

  return (
    <div>
      {/* Header */}
      <div className="v2-acc-head">
        <div>
          <div className="v2-eyebrow">Admin · Access</div>
          <h1 className="v2-h1">Organizations</h1>
          <div className="v2-sub">Clerk organizations across the estate and their members · read-only</div>
        </div>
      </div>

      {orgs.length === 0 ? (
        <div className="v2-card">
          <div className="v2-acc-empty">
            <div className="t">No organizations</div>
            <div className="d">
              No Clerk organizations exist yet. Teams created in Clerk will appear here automatically.
            </div>
          </div>
        </div>
      ) : (
        orgs.map((o) => (
          <div key={o.id} className="v2-card v2-acc-mt" style={{ overflow: 'hidden' }}>
            <div className="v2-acc-org-h">
              <h3>{o.name}</h3>
              <span className="v2-pill info">
                {o.membersCount} member{o.membersCount === 1 ? '' : 's'}
              </span>
            </div>

            {o.members.length === 0 ? (
              <div className="v2-acc-empty">
                <div className="d">No members loaded.</div>
              </div>
            ) : (
              <table className="v2-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Org role</th>
                  </tr>
                </thead>
                <tbody>
                  {o.members.map((m) => {
                    const isAdmin = ADMIN_ROLES.has(m.role);
                    return (
                      <tr key={m.userId}>
                        <td>
                          <div className="v2-acc-member">
                            <span className="v2-acc-av">{monogram(m.label)}</span>
                            <span className="v2-acc-mlabel">{m.label}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`v2-acc-role${isAdmin ? ' adm' : ''}`}>{m.role}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}
