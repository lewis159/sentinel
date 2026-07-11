import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { getCustomer360 } from '@/lib/data';
import { type Severity } from '@/lib/mock';
import './customer.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Customer 360 — a support agent's single view of one customer/tenant. Backed by
// real `ops` data (getCustomer360): the tenant's tickets (scoped by tenant_ref /
// customer_email), its Clerk-org mirror (ops.orgs), members (ops.org_members) and
// read-through entitlements (ops.app_entitlements). Falls back to a plausible mock
// when the DB is unreachable so the screen still renders in dev.
// ---------------------------------------------------------------------------

// Two-letter avatar initials from a display name/id.
function initials(label: string): string {
  const first = label.trim().toLowerCase().split(/[.\-_@\s]+/).filter(Boolean)[0] ?? label;
  const letters = first.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

function priorityPill(p: Severity): { cls: string; label: string } {
  switch (p) {
    case 'critical':
      return { cls: 'crit', label: 'Critical' };
    case 'high':
      return { cls: 'high', label: 'High' };
    default:
      return { cls: 'info', label: p.charAt(0).toUpperCase() + p.slice(1) };
  }
}

// A ticket is "open" unless it's in a terminal workflow state.
const TERMINAL = new Set(['closed', 'resolved', 'fulfilled', 'deployed', 'verified']);

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSectionPage('support');
  const { id } = await params;

  const cust = await getCustomer360(id);
  const av = initials(cust.name);

  const openTickets = cust.tickets.filter((t) => !TERMINAL.has(t.status));
  const ent = cust.entitlements[0] ?? null; // primary entitlement for the quota tile
  const quotaPct =
    ent && ent.quotaLimit && ent.quotaUsed != null
      ? Math.round((ent.quotaUsed / ent.quotaLimit) * 100)
      : null;

  return (
    <div className="v2-cust-page">
      {/* ---------- Header ---------- */}
      <div className="v2-cust-head">
        <span className="v2-cust-avatar">{av}</span>
        <div className="v2-cust-head-main">
          <div className="v2-eyebrow">Support · Customer 360</div>
          <h1 className="v2-h1">{cust.name}</h1>
          <div className="v2-sub">
            {cust.org ? `Org ${cust.org.id}` : 'No linked organisation'}
            {' · '}
            {cust.members.length} member{cust.members.length === 1 ? '' : 's'}
            {ent?.tier ? ` · ${ent.tier} tier` : ''}
          </div>
        </div>
        <div className="v2-cust-head-pills">
          {cust.live ? (
            <span className="v2-pill ok">Live</span>
          ) : (
            <span className="v2-pill info">Mock{cust.note ? ` · ${cust.note}` : ''}</span>
          )}
        </div>
      </div>

      {/* ---------- Stat strip ---------- */}
      <div className="v2-cust-stats">
        <div className="v2-tile t-sky">
          <div className="k">Open tickets</div>
          <div className="v">{openTickets.length}</div>
          <div className="meta">{cust.tickets.length} total</div>
        </div>
        <div className="v2-tile t-ok">
          <div className="k">Members</div>
          <div className="v">{cust.members.length}</div>
          <div className="meta">{cust.org ? 'in linked org' : 'no org mirror'}</div>
        </div>
        <div className={`v2-tile ${quotaPct != null && quotaPct >= 90 ? 't-high' : 't-ok'}`}>
          <div className="k">Usage</div>
          <div className="v">
            {ent && ent.quotaUsed != null ? ent.quotaUsed.toLocaleString() : '—'}
            {ent?.quotaLimit ? (
              <span className="v2-cust-tile-of">/{ent.quotaLimit.toLocaleString()}</span>
            ) : null}
          </div>
          <div className="meta">{quotaPct != null ? `${quotaPct}% of quota` : 'not synced'}</div>
        </div>
        <div className="v2-tile t-ok">
          <div className="k">Entitlements</div>
          <div className="v">{cust.entitlements.length}</div>
          <div className="meta">apps synced</div>
        </div>
      </div>

      {/* ---------- Two-column ---------- */}
      <div className="v2-cust-grid">
        {/* ===== LEFT — tickets ===== */}
        <div className="v2-card">
          <div className="v2-card-h">
            <h3>Tickets</h3>
            <Link href="/v2/support" className="v2-link">
              View all
            </Link>
          </div>
          <div className="v2-cust-tickets">
            {cust.tickets.length === 0 ? (
              <div className="v2-cust-arow" style={{ padding: '16px' }}>
                <span className="k">No tickets for this customer yet.</span>
              </div>
            ) : (
              cust.tickets.map((t) => {
                const pill = priorityPill(t.priority);
                return (
                  <Link key={t.ref} href={`/v2/support/${t.ref}`} className="v2-cust-trow">
                    <span className="v2-cust-tref">{t.ref}</span>
                    <span className="v2-cust-ttitle">{t.title}</span>
                    <span className="v2-cust-tage">{t.age}</span>
                    <span className={`v2-pill ${pill.cls}`}>{pill.label}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* ===== RIGHT — stacked cards ===== */}
        <div className="v2-cust-side">
          {/* Members */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Members</h3>
              <span className="v2-cust-cycle">{cust.members.length} total</span>
            </div>
            <div className="v2-cust-account">
              {cust.members.length === 0 ? (
                <div className="v2-cust-arow">
                  <span className="k">No org members mirrored.</span>
                </div>
              ) : (
                cust.members.map((m) => (
                  <div key={m.userId} className="v2-cust-arow">
                    <span className="k">{m.userId}</span>
                    <span className="val">{m.role ?? 'member'}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Entitlements */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Entitlements</h3>
              <span className="v2-cust-cycle">Read-through</span>
            </div>
            <div className="v2-cust-account">
              {cust.entitlements.length === 0 ? (
                <div className="v2-cust-arow">
                  <span className="k">No entitlements synced yet.</span>
                </div>
              ) : (
                cust.entitlements.map((e, i) => (
                  <div key={`${e.userId}-${e.app}-${i}`} className="v2-cust-arow">
                    <span className="k">
                      {e.app.toUpperCase()}
                      {e.tier ? ` · ${e.tier}` : ''}
                    </span>
                    <span className="val">
                      {e.quotaUsed != null && e.quotaLimit != null
                        ? `${e.quotaUsed}/${e.quotaLimit} ${e.quotaPeriod ?? ''}`.trim()
                        : e.syncedAt
                          ? 'synced'
                          : 'not synced'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Account */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Account</h3>
            </div>
            <div className="v2-cust-account">
              <div className="v2-cust-arow">
                <span className="k">Primary email</span>
                <span className="val">{cust.email ?? '—'}</span>
              </div>
              <div className="v2-cust-arow">
                <span className="k">Organisation</span>
                <span className="val">{cust.org ? (cust.org.name ?? cust.org.id) : '—'}</span>
              </div>
              <div className="v2-cust-arow">
                <span className="k">Tenant ref</span>
                <span className="val">{cust.org?.id ?? cust.id}</span>
              </div>
              <div className="v2-cust-arow">
                <span className="k">Tickets</span>
                <span className="val">{cust.tickets.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
