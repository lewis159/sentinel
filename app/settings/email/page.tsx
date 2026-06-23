import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import {
  getEmailStats,
  getEmailTemplates,
  getEmailSettings,
  type EmailTemplate,
} from '@/lib/email-portal';

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

export default async function EmailOverviewPage() {
  await requireGlobalAdminPage();

  const { data: stats, live, note } = await getEmailStats();
  const { data: templates } = await getEmailTemplates();
  const { data: settings } = await getEmailSettings();
  const provider = settings.provider;

  const metrics: { label: string; value: string }[] = [
    { label: 'Sent · 30d', value: stats.sent30d.toLocaleString() },
    { label: 'Delivered %', value: `${stats.deliveredPct}%` },
    { label: 'Bounced', value: String(stats.bounced) },
    { label: 'Templates', value: String(stats.templates) },
  ];

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Email</div>
          <div className="sub">Centrally-managed templates, themes &amp; delivery</div>
        </div>
        <div className="row">
          <button className="btn">+ New template</button>
        </div>
      </div>

      <EmailNav />

      <div className="row mb" style={{ gap: 10 }}>
        <span className={`pill live-badge${live ? '' : ' mock'}`}>
          <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
          {live ? 'LIVE · email store' : `mock${note ? ' · ' + note : ''}`}
        </span>
      </div>

      <div className="row mb sub" style={{ gap: 8 }}>
        <span className="dot" style={{ background: provider.connected ? 'var(--ok)' : 'var(--muted)' }} />
        {provider.connected ? '✅' : '⚠️'} Provider {provider.name} · domain {provider.domain} · {provider.region}
      </div>

      <div className="grid grid-4 mb">
        {metrics.map((m) => (
          <div key={m.label} className="card">
            <div className="k">{m.label}</div>
            <div className="v">{m.value}</div>
          </div>
        ))}
      </div>

      <div className="h1 mb" style={{ fontSize: 16 }}>Templates</div>

      <div className="grid grid-3 mb">
        {templates.map((t: EmailTemplate) => (
          <Link
            key={t.id}
            href={`/settings/email/templates/${t.id}`}
            className="card"
            style={{ display: 'block', textDecoration: 'none' }}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <div className="t" style={{ fontWeight: 700 }}>{t.name}</div>
              </div>
              <span className={`tag ${t.status === 'active' ? 'st-done' : 'st-mute'}`}>
                {t.status === 'active' ? 'Active' : 'Draft'}
              </span>
            </div>

            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {t.apps.map((app) => (
                <span
                  key={app}
                  className="pill"
                  style={{ fontSize: 10.5, ...appBadge(app) }}
                >
                  {app}
                </span>
              ))}
            </div>

            <div className="sub" style={{ marginTop: 10 }}>
              📤 {t.sent30d.toLocaleString()} · {t.bounceRate}% bounce
            </div>
          </Link>
        ))}
      </div>

      <Link className="link" href="/settings">← Back to settings</Link>
    </div>
  );
}
