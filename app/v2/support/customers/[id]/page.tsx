import Link from 'next/link';
import { requireSectionPage } from '@/lib/auth';
import { type Severity } from '@/lib/mock';
import './customer.css';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Customer 360 — a support agent's single view of one customer. There is no
// backend behind this yet, so the record is derived from the route `id` plus
// static, human-plausible context (plan, usage, tickets, Hermes note). No
// lorem: the customer's name/initials come straight from `id`.
// ---------------------------------------------------------------------------

// Turn a route id into a display domain. "northwind" → "northwind.io";
// "northwind.io" is left as-is so real-looking ids pass through unchanged.
function customerName(id: string): string {
  const clean = id.trim().toLowerCase();
  return clean.includes('.') ? clean : `${clean}.io`;
}

// Two-letter avatar initials from the primary label of the id.
function initials(id: string): string {
  const label = id.trim().toLowerCase().split(/[.\-_\s]+/).filter(Boolean)[0] ?? id;
  const letters = label.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

interface OpenTicket {
  ref: string;
  title: string;
  priority: Severity;
  age: string;
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

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSectionPage('support');
  const { id } = await params;

  const name = customerName(id);
  const av = initials(id);

  // Static, plausible open tickets for this customer. Refs link into the
  // existing ticket detail route (/v2/support/{ref}).
  const openTickets: OpenTicket[] = [
    { ref: 'SUP-0212', title: 'Team hitting the 2,000-video cycle cap early', priority: 'high', age: '4h ago' },
    { ref: 'SUP-0208', title: 'Request: add two more editor seats', priority: 'medium', age: '1d ago' },
    { ref: 'OPS-0006', title: 'Occasional 429s on the public submit endpoint', priority: 'low', age: '2d ago' },
  ];

  return (
    <div className="v2-cust-page">
      {/* ---------- Header ---------- */}
      <div className="v2-cust-head">
        <span className="v2-cust-avatar">{av}</span>
        <div className="v2-cust-head-main">
          <div className="v2-eyebrow">Support · Customer 360</div>
          <h1 className="v2-h1">{name}</h1>
          <div className="v2-sub">Business plan · customer 14 months · 8 seats</div>
        </div>
        <div className="v2-cust-head-pills">
          <span className="v2-pill ok">Healthy</span>
          <span className="v2-cust-pill-upsell">Upsell candidate</span>
        </div>
      </div>

      {/* ---------- Stat strip ---------- */}
      <div className="v2-cust-stats">
        <div className="v2-tile t-ok">
          <div className="k">MRR</div>
          <div className="v">£690</div>
          <div className="meta">Business · billed monthly</div>
        </div>
        <div className="v2-tile t-high">
          <div className="k">Videos this cycle</div>
          <div className="v">1,840<span className="v2-cust-tile-of">/2000</span></div>
          <div className="meta">92% · near cap</div>
        </div>
        <div className="v2-tile t-sky">
          <div className="k">Seats</div>
          <div className="v">8<span className="v2-cust-tile-of">/10</span></div>
          <div className="meta">2 seats free</div>
        </div>
        <div className="v2-tile t-ok">
          <div className="k">NPS</div>
          <div className="v">9</div>
          <div className="meta">Promoter · surveyed 3w ago</div>
        </div>
      </div>

      {/* ---------- Two-column ---------- */}
      <div className="v2-cust-grid">
        {/* ===== LEFT — Open tickets ===== */}
        <div className="v2-card">
          <div className="v2-card-h">
            <h3>Open tickets</h3>
            <Link href="/v2/support" className="v2-link">
              View all
            </Link>
          </div>
          <div className="v2-cust-tickets">
            {openTickets.map((t) => {
              const pill = priorityPill(t.priority);
              return (
                <Link key={t.ref} href={`/v2/support/${t.ref}`} className="v2-cust-trow">
                  <span className="v2-cust-tref">{t.ref}</span>
                  <span className="v2-cust-ttitle">{t.title}</span>
                  <span className="v2-cust-tage">{t.age}</span>
                  <span className={`v2-pill ${pill.cls}`}>{pill.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ===== RIGHT — stacked cards ===== */}
        <div className="v2-cust-side">
          {/* Usage */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Usage</h3>
              <span className="v2-cust-cycle">This cycle</span>
            </div>
            <div className="v2-cust-usage">
              <div className="v2-bars">
                <div className="v2-bar-row">
                  <span className="lab">Videos</span>
                  <span className="v2-track">
                    <span className="v2-fill" style={{ width: '92%', background: 'var(--high)' }} />
                  </span>
                  <span className="n">92%</span>
                </div>
                <div className="v2-bar-row">
                  <span className="lab">Storage</span>
                  <span className="v2-track">
                    <span className="v2-fill" style={{ width: '64%', background: 'var(--ok)' }} />
                  </span>
                  <span className="n">64%</span>
                </div>
                <div className="v2-bar-row">
                  <span className="lab">API</span>
                  <span className="v2-track">
                    <span className="v2-fill" style={{ width: '78%', background: 'var(--accent)' }} />
                  </span>
                  <span className="n">78%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Hermes note */}
          <div className="v2-card v2-cust-hermes">
            <div className="v2-card-h">
              <h3>Hermes note</h3>
              <span className="v2-cust-hermes-badge">Copilot</span>
            </div>
            <div className="v2-cust-hermes-body">
              <p>
                {name} has run at <b>90%+</b> of their video cap for three consecutive cycles and just added
                their 8th seat. On current trend they will breach the Business cap next cycle. A move to
                <b> Studio</b> lifts the cap to 5,000 and adds two seats at roughly <b>£29/mo</b> — a clean
                upsell with no risk of churn given their NPS of 9.
              </p>
              <div className="v2-cust-hermes-actions">
                <button className="v2-btn">Draft upsell email</button>
                <button className="v2-btn ghost">Dismiss</button>
              </div>
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
                <span className="val">ops@{name}</span>
              </div>
              <div className="v2-cust-arow">
                <span className="k">Renews</span>
                <span className="val">14 Aug 2026</span>
              </div>
              <div className="v2-cust-arow">
                <span className="k">Entitlements</span>
                <span className="val">4 apps</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
