import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import { getEmailSettings } from '@/lib/email-portal';

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

// Visual-only toggle (rough markup — no handlers). 34x19 rounded pill with a
// 15px white knob; ON = blue track + knob right, OFF = grey track + knob left.
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 34,
        height: 19,
        borderRadius: 999,
        padding: 2,
        background: on ? 'var(--blue)' : 'var(--panel-2)',
        border: on ? '1px solid var(--blue)' : '1px solid var(--border)',
        justifyContent: on ? 'flex-end' : 'flex-start',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#fff' }} />
    </span>
  );
}

const sectionLabel: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  fontWeight: 600,
  marginBottom: 8,
};

const fieldLabel: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  fontWeight: 600,
  marginBottom: 4,
};

export default async function EmailConfigPage() {
  await requireGlobalAdminPage();

  const { data: s, live } = await getEmailSettings();
  const p = s.provider;

  const dnsChecks: { label: string; ok: boolean }[] = [
    { label: 'SPF', ok: p.spf },
    { label: 'DKIM', ok: p.dkim },
    { label: 'DMARC', ok: p.dmarc },
  ];

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Email configuration</div>
          <div className="sub">Provider, sending identity &amp; notifications</div>
        </div>
      </div>

      <EmailNav />

      <div className="row mb" style={{ gap: 10 }}>
        <span className={`pill live-badge${live ? '' : ' mock'}`}>
          <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
          {live ? 'LIVE · email store' : 'mock'}
        </span>
      </div>

      {/* Provider */}
      <div style={sectionLabel}>Provider</div>
      <div className="card mb">
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: 18 }}>{p.connected ? '📮' : '✉️'}</span>
          <b>{p.name}</b>
          {p.connected && <span className="tag st-done">connected</span>}
          <span className="sub" style={{ marginLeft: 'auto' }}>{p.region}</span>
        </div>

        <div className="grid grid-4 mt">
          <div>
            <div style={fieldLabel}>Domain</div>
            <code>{p.domain}</code>
          </div>
          {dnsChecks.map((c) => (
            <div key={c.label}>
              <div style={fieldLabel}>{c.label}</div>
              {c.ok ? (
                <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓ pass</span>
              ) : (
                <span className="sub">— fail</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sending identity */}
      <div style={sectionLabel}>Sending identity</div>
      <div className="card pad0 mb">
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>From</th>
              <th>Reply-to</th>
            </tr>
          </thead>
          <tbody>
            {s.identities.map((id) => (
              <tr key={id.app}>
                <td>
                  <span className="pill" style={{ fontSize: 10.5, ...appBadge(id.app) }}>
                    {id.app}
                  </span>
                </td>
                <td><code>{id.from}</code></td>
                <td><code>{id.replyTo}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notifications */}
      <div style={sectionLabel}>Notifications</div>
      <div className="card pad0 mb">
        {s.notifications.map((n, i) => (
          <div
            key={n.key}
            className="spread"
            style={{
              padding: '13px 16px',
              borderBottom: i < s.notifications.length - 1 ? '1px solid var(--border-soft)' : 'none',
            }}
          >
            <div>
              <div>{n.label}</div>
              <div className="sub">{n.desc}</div>
              {n.key === 'invite_reminder' && (
                <div className="row sub mt" style={{ gap: 6, marginTop: 8 }}>
                  1st after
                  <input type="number" defaultValue={s.reminderDays[0]} style={{ width: 54 }} />
                  d · 2nd after
                  <input type="number" defaultValue={s.reminderDays[1]} style={{ width: 54 }} />
                  d
                </div>
              )}
            </div>
            <Toggle on={n.enabled} />
          </div>
        ))}
      </div>

      <Link className="link" href="/settings/email">← Back to email</Link>
    </div>
  );
}
