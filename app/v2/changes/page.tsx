import './changes.css';
import { requireSectionPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Sentinel v2 — Change calendar / CAB. Renders inside the v2 shell
// (.v2-shell > .v2-content); this file supplies page content only.
//
// Everything here is static/plausible mock data so the page stays reliably
// buildable without live infra. The month grid is a fixed "July 2026" layout —
// no dates are computed at render time. July 1 2026 falls on a Wednesday, weeks
// start Monday, and "today" is pinned to Wed July 8.

type Tone = 'ok' | 'high' | 'sky' | 'crit';
type Chip = { ref: string; label: string; tone: Tone };
type Day = {
  day: number;
  muted?: boolean; // adjacent-month day → dim
  today?: boolean;
  chips?: Chip[];
};

// Fixed July 2026 grid (Mon-first). Leading days spill from June, trailing from
// August; both are flagged `muted` so the cell dims.
const WEEKS: Day[][] = [
  [
    { day: 29, muted: true },
    { day: 30, muted: true },
    { day: 1, chips: [{ ref: 'CHG-081', label: 'Cert renew', tone: 'sky' }] },
    { day: 2, chips: [{ ref: 'CHG-085', label: 'Deploy web 2.4', tone: 'ok' }] },
    { day: 3, chips: [{ ref: 'FRZ-07', label: 'Holiday freeze', tone: 'crit' }] },
    { day: 4, chips: [{ ref: 'FRZ-07', label: 'Freeze', tone: 'crit' }] },
    { day: 5, chips: [{ ref: 'FRZ-07', label: 'Freeze', tone: 'crit' }] },
  ],
  [
    { day: 6, chips: [{ ref: 'CHG-086', label: 'Redis 7.4 bump', tone: 'ok' }] },
    { day: 7 },
    { day: 8, today: true, chips: [{ ref: 'CHG-087', label: 'NPM proxy cfg', tone: 'sky' }] },
    { day: 9 },
    { day: 10, chips: [{ ref: 'CHG-089', label: 'Grafana upgrade', tone: 'ok' }] },
    { day: 11 },
    { day: 12 },
  ],
  [
    { day: 13 },
    { day: 14 },
    { day: 15, chips: [{ ref: 'CHG-088', label: 'JWT key rotation', tone: 'high' }] },
    { day: 16 },
    { day: 17, chips: [{ ref: 'CHG-092', label: 'Clerk prod cfg', tone: 'high' }] },
    { day: 18 },
    { day: 19 },
  ],
  [
    { day: 20 },
    { day: 21 },
    { day: 22, chips: [{ ref: 'CHG-090', label: 'DB maintenance', tone: 'sky' }] },
    { day: 23 },
    { day: 24, chips: [{ ref: 'CHG-093', label: 'Deploy web 2.5', tone: 'ok' }] },
    { day: 25 },
    { day: 26 },
  ],
  [
    { day: 27 },
    { day: 28 },
    { day: 29 },
    { day: 30 },
    { day: 31, chips: [{ ref: 'FRZ-08', label: 'Month-end freeze', tone: 'crit' }] },
    { day: 1, muted: true },
    { day: 2, muted: true },
  ],
];

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type RiskTone = 'high' | 'crit' | 'info' | 'ok';
type CabRow = {
  ref: string;
  title: string;
  risk: string;
  riskTone: RiskTone;
  requester: string;
  window: string;
};

const CAB_QUEUE: CabRow[] = [
  {
    ref: 'CHG-088',
    title: 'JWT signing-key rotation (estate SSO)',
    risk: 'High risk',
    riskTone: 'high',
    requester: 'Security',
    window: 'Wed 15 Jul · 02:00–02:45',
  },
  {
    ref: 'CHG-090',
    title: 'Postgres 16.3 minor upgrade — primary + replica',
    risk: 'Medium risk',
    riskTone: 'info',
    requester: 'Operations',
    window: 'Wed 22 Jul · 03:00–04:30',
  },
  {
    ref: 'CHG-092',
    title: 'Clerk production OAuth redirect update',
    risk: 'Low risk',
    riskTone: 'ok',
    requester: 'Platform',
    window: 'Fri 17 Jul · 09:00–09:20',
  },
];

export default async function ChangeCalendarPage() {
  await requireSectionPage('operations');

  return (
    <div className="v2-cal">
      {/* Header */}
      <div className="v2-cal-head">
        <div>
          <div className="v2-eyebrow">Operations · Delivery</div>
          <h1 className="v2-h1">Change calendar</h1>
          <div className="v2-sub">Scheduled changes, maintenance windows, approvals</div>
        </div>

        <div className="v2-cal-controls">
          <div className="v2-cal-monthnav">
            <button className="v2-cal-navbtn" type="button" aria-label="Previous month">
              ◂
            </button>
            <span className="v2-cal-monthlabel">July 2026</span>
            <button className="v2-cal-navbtn" type="button" aria-label="Next month">
              ▸
            </button>
          </div>

          <div className="v2-cal-seg" role="group" aria-label="Calendar view">
            <button className="on" type="button">
              Month
            </button>
            <button type="button">Week</button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="v2-cal-legend">
        <span>
          <i className="v2-cal-swatch ok" />
          Completed
        </span>
        <span>
          <i className="v2-cal-swatch high" />
          Pending approval
        </span>
        <span>
          <i className="v2-cal-swatch sky" />
          Scheduled
        </span>
        <span>
          <i className="v2-cal-swatch crit" />
          Change freeze
        </span>
      </div>

      {/* Month grid */}
      <div className="v2-card v2-cal-grid">
        <div className="v2-cal-dow">
          {DOW.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        {WEEKS.map((week, wi) => (
          <div className="v2-cal-week" key={wi}>
            {week.map((cell, ci) => (
              <div
                key={ci}
                className={`v2-cal-cell${cell.muted ? ' dim' : ''}${cell.today ? ' today' : ''}`}
              >
                <span className="v2-cal-daynum">{cell.day}</span>
                {cell.chips?.map((chip, i) => (
                  <span key={i} className={`v2-cal-chip ${chip.tone}`} title={`${chip.ref} · ${chip.label}`}>
                    {chip.ref} · {chip.label}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* CAB queue */}
      <div className="v2-card">
        <div className="v2-card-h">
          <h3>CAB queue · awaiting approval</h3>
          <span className="v2-link">Change policy</span>
        </div>

        {CAB_QUEUE.map((row) => (
          <div className="v2-cal-cab-row" key={row.ref}>
            <div>
              <div className="v2-cal-cab-ref">{row.ref}</div>
              <div className="v2-cal-cab-title">{row.title}</div>
              <div className="v2-cal-cab-meta">
                <span className={`v2-pill ${row.riskTone}`}>{row.risk}</span>
                <span className="dot" />
                <span>{row.requester}</span>
                <span className="dot" />
                <span>{row.window}</span>
              </div>
            </div>

            <div className="v2-cal-cab-actions">
              <button className="v2-cal-approve" type="button">
                Approve
              </button>
              <button className="v2-cal-reject" type="button">
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
