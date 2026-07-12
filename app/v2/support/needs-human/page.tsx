import Link from 'next/link';
import '../support.css';
import './needs-human.css';
import { requireSectionPage, getSessionAccess } from '@/lib/auth';
import { authorize } from '@/lib/support/roles';
import { getSupportStaff } from '@/lib/support/data';
import { getNeedsHumanQueue } from '@/lib/support/needs-human-view';
import { AssignControl, EscalateControl } from '@/components/v2/support-assign';

export const dynamic = 'force-dynamic';

// Two-letter initials for an avatar circle (kept in step with SupportTable).
function initials(name: string): string {
  const parts = name.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function CheckIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default async function NeedsHumanPage() {
  // Section gate — same RBAC the rest of the support desk uses.
  await requireSectionPage('support');

  // Resolve the caller's support-action authority so the per-row assign/escalate
  // controls render only for permitted roles (reused from the ticket detail page).
  const { role } = await getSessionAccess();
  const canAssign = authorize(role, 'assign') === 'allow';
  const canEscalate = authorize(role, 'escalate') === 'allow';

  const [{ rows, live }, staff] = await Promise.all([
    getNeedsHumanQueue(),
    getSupportStaff(),
  ]);

  const nameById = new Map(staff.map((s) => [s.clerkUserId, s.displayName]));
  const staffOpts = staff.map((s) => ({
    clerkUserId: s.clerkUserId,
    displayName: s.displayName,
    tier: s.tier,
  }));

  const showActions = canAssign || canEscalate;

  return (
    <div className="v2-sup-page">
      {/* Header */}
      <div className="spread" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="v2-eyebrow">Support</div>
          <h1 className="v2-h1">Needs human</h1>
          <div className="v2-sub">
            {rows.length === 0
              ? 'Nothing is waiting on a person right now.'
              : `${rows.length} ticket${rows.length === 1 ? '' : 's'} waiting on a person · most urgent first`}
          </div>
        </div>
        <Link href="/v2/support" className="v2-btn ghost" style={{ flexShrink: 0, textDecoration: 'none' }}>
          Customer desk
        </Link>
      </div>

      {rows.length === 0 ? (
        // ---------- Empty state ----------
        <div className="v2-card">
          <div className="v2-nh-empty">
            <span className="ic"><CheckIcon /></span>
            <h3>Nothing needs a human right now</h3>
            <p>
              Tickets flagged by intake or escalated to the human gate will appear here,
              most urgent first. The queue is clear.
            </p>
          </div>
        </div>
      ) : (
        // ---------- Queue table ----------
        <div className="v2-card" style={{ overflow: 'hidden' }}>
          <div className="v2-sup-tablebar">
            <span className={`v2-sup-live ${live ? 'on' : 'off'}`} title={live ? 'Live data' : 'Mock data'}>
              {live ? 'Live' : 'Mock'}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Subject</th>
                  <th>Customer</th>
                  <th>Why</th>
                  <th>Priority</th>
                  <th>SLA</th>
                  <th>Age</th>
                  <th>Owner</th>
                  {showActions && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const ownerName = t.assigneeId ? nameById.get(t.assigneeId) ?? t.assigneeId : '';
                  return (
                    <tr key={t.ref}>
                      <td>
                        <Link href={`/v2/support/${t.ref}`} className="v2-sup-open">
                          <span className="v2-sup-ref">{t.ref}</span>
                        </Link>
                      </td>
                      <td>
                        <Link href={`/v2/support/${t.ref}`} className="v2-sup-open">
                          <div className="v2-sup-subj">{t.title}</div>
                        </Link>
                      </td>
                      <td>
                        <span className="v2-sup-who">
                          <span className="v2-sup-av">{initials(t.customer)}</span>
                          {t.customerHref ? (
                            <Link href={t.customerHref} className="v2-sup-custlink">
                              {t.customer}
                            </Link>
                          ) : (
                            <span className="nm">{t.customer}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className={`v2-nh-reason ${t.flaggedByIntake ? 'intake' : 'ladder'}`}>
                          {t.reason}
                        </span>
                      </td>
                      <td>
                        <span className={`v2-pill ${t.priorityCls}`}>{t.priorityLabel}</span>
                      </td>
                      <td>
                        <span className={`v2-sup-sla ${t.slaClass}`}>{t.slaLabel}</span>
                      </td>
                      <td>
                        <span className="v2-nh-age">{t.age}</span>
                      </td>
                      <td>
                        {ownerName ? (
                          <span className="v2-sup-who">
                            <span className="v2-sup-av">{initials(ownerName)}</span>
                            <span className="nm">{ownerName}</span>
                          </span>
                        ) : (
                          <span className="v2-sup-who">
                            <span className="v2-sup-av muted">?</span>
                            <span className="nm faint">Unassigned</span>
                          </span>
                        )}
                      </td>
                      {showActions && (
                        <td>
                          <div className="v2-nh-actions">
                            {canAssign && (
                              <AssignControl refId={t.ref} staff={staffOpts} current={t.assigneeId} />
                            )}
                            {canEscalate && <EscalateControl refId={t.ref} />}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
