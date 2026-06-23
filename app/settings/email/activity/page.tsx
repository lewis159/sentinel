import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import { getEmailActivity, getEmailStats, type EmailActivityEvent } from '@/lib/email-portal';

export const dynamic = 'force-dynamic';

// Brand swatch for the YT app badge (the only hardcoded theme colour allowed).
const YT_RED = '#E53935';

function appBadge(app: string) {
  if (app === 'YT') {
    return { background: 'color-mix(in srgb, ' + YT_RED + ' 16%, transparent)', color: YT_RED };
  }
  if (app === 'Sentinel') {
    return { background: 'var(--accent-bg)', color: 'var(--blue)' };
  }
  return { background: 'var(--panel-2)', color: 'var(--muted)' };
}

// Status → tag class mapping (all .st-* classes exist in globals.css).
const STATUS_TAG: Record<EmailActivityEvent['status'], string> = {
  delivered: 'tag st-done',
  opened: 'tag st-blue',
  bounced: 'tag st-prog',
  complaint: 'tag st-open',
  sent: 'tag st-mute',
};

function statusTagClass(status: EmailActivityEvent['status']): string {
  return STATUS_TAG[status] ?? 'tag st-mute';
}

export default async function EmailActivityPage() {
  await requireGlobalAdminPage();

  const { data: events, live } = await getEmailActivity();
  const { data: stats } = await getEmailStats();

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Activity</div>
          <div className="sub">Per-recipient deliverability</div>
        </div>
      </div>

      <EmailNav />

      <div className="row mb" style={{ gap: 10 }}>
        <span className={`pill live-badge${live ? '' : ' mock'}`}>
          <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
          {live ? 'LIVE · email store' : 'mock'}
        </span>
      </div>

      <div className="grid grid-4 mb">
        <div className="card">
          <div className="k">Delivered</div>
          <div className="v" style={{ color: 'var(--ok)' }}>{stats.deliveredPct}%</div>
        </div>
        <div className="card">
          <div className="k">Opened</div>
          <div className="v">{stats.openedPct}%</div>
        </div>
        <div className="card">
          <div className="k">Bounced</div>
          <div className="v" style={{ color: 'var(--high)' }}>{stats.bounced}</div>
        </div>
        <div className="card">
          <div className="k">Complaints</div>
          <div className="v" style={{ color: 'var(--crit)' }}>{stats.complaints}</div>
        </div>
      </div>

      <div className="row mb" style={{ gap: 8 }}>
        <input placeholder="Search recipient…" style={{ flex: 1 }} />
        <select><option>Template</option></select>
        <select><option>Status</option></select>
        <Link className="link" href="/settings/email/activity" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          🚫 Suppression (3)
        </Link>
      </div>

      <div className="card pad0">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Recipient</th>
              <th>Template</th>
              <th>App</th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="sub mono">{e.time}</td>
                <td>{e.recipient}</td>
                <td>{e.template}</td>
                <td>
                  <span className="pill" style={{ fontSize: 10.5, ...appBadge(e.app) }}>{e.app}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className={statusTagClass(e.status)}>{e.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link className="link" href="/settings/email" style={{ display: 'inline-block', marginTop: 14 }}>
        ← Back to email
      </Link>
    </div>
  );
}
