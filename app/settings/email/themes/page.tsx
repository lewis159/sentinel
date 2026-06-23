import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import { getEmailThemes, type EmailTheme } from '@/lib/email-portal';

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

export default async function EmailThemesPage() {
  await requireGlobalAdminPage();

  const { data: themes, live } = await getEmailThemes();

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Themes</div>
          <div className="sub">Brand skins templates can adopt</div>
        </div>
        <div className="row">
          <button className="btn">+ New theme</button>
        </div>
      </div>

      <EmailNav />

      <div className="row mb" style={{ gap: 10 }}>
        <span className={`pill live-badge${live ? '' : ' mock'}`}>
          <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--muted)' }} />
          {live ? 'LIVE · email store' : 'mock'}
        </span>
      </div>

      <div className="grid grid-3 mb">
        {themes.map((t: EmailTheme) => (
          <Link
            key={t.id}
            href={`/settings/email/themes/${t.id}`}
            className="card"
            style={{ display: 'block', textDecoration: 'none' }}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div className="row" style={{ gap: 10 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: t.brandColor,
                    border: '1px solid var(--border)',
                    flexShrink: 0,
                  }}
                />
                <div className="t" style={{ fontWeight: 700 }}>{t.name}</div>
              </div>
              <span className="pill" style={{ fontSize: 10.5, ...appBadge(t.app) }}>
                {t.app}
              </span>
            </div>

            <div className="sub" style={{ marginTop: 10 }}>
              header: {t.headerStyle} · {t.footer}
            </div>
          </Link>
        ))}
      </div>

      <Link className="link" href="/settings/email">← Back to email</Link>
    </div>
  );
}
