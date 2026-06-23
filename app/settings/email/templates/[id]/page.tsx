import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import {
  getEmailTemplate,
  getEmailThemes,
  type EmailTheme,
} from '@/lib/email-portal';

export const dynamic = 'force-dynamic';

// Brand swatch for the YT app badge (the only hardcoded theme colour allowed).
const YT_RED = '#E53935';

// Fallback brand colour when a template has no resolvable theme.
const DEFAULT_BRAND = '#2D6CFF';

// Small muted field label shown above each control on the rail.
const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  fontWeight: 600,
  display: 'block',
  marginBottom: 5,
};

export default async function EmailTemplateStudioPage({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;

  const { data: tpl } = await getEmailTemplate(id);

  if (!tpl) {
    return (
      <div>
        <div className="card mb">
          <div className="h1" style={{ fontSize: 16 }}>Template not found</div>
          <div className="sub">No email template matches “{id}”.</div>
        </div>
        <Link className="link" href="/settings/email">← Back to email</Link>
      </div>
    );
  }

  const { data: themes } = await getEmailThemes();

  // Resolve the template's theme ids to full theme records (preserve order).
  const tplThemes: EmailTheme[] = tpl.themes
    .map((tid) => themes.find((t) => t.id === tid))
    .filter((t): t is EmailTheme => Boolean(t));

  // The first matching theme drives the live preview; fall back to a default.
  const activeTheme: EmailTheme = tplThemes[0] ?? {
    id: 'default',
    name: 'Default',
    app: 'Default',
    brandColor: DEFAULT_BRAND,
    headerStyle: 'dark',
    logo: '',
    footer: 'bentech.dev',
  };

  const isYtTheme = activeTheme.app === 'YT';

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">{tpl.name}</div>
          <div className="sub">Studio editor</div>
        </div>
        <div className="row">
          <button className="btn ghost">Send test</button>
          <button className="btn">Save</button>
        </div>
      </div>

      <EmailNav />

      {/* Theme switch + viewport toggles */}
      <div className="spread mb">
        <div className="row wrap" style={{ gap: 8 }}>
          {tplThemes.map((t, i) => (
            <span key={t.id} className={`chip${i === 0 ? ' on' : ''}`}>
              <span className="dot" style={{ background: t.brandColor }} />
              {t.name}
            </span>
          ))}
          <span className="chip">+ theme</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="mono" style={{ fontSize: 14, color: 'var(--blue)' }}>🖥</span>
          <span className="mono" style={{ fontSize: 14, color: 'var(--muted)' }}>📱</span>
        </div>
      </div>

      {/* Two-column: live preview + controls rail */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 280px', gap: 14 }}>
        {/* LEFT — live email preview */}
        <div
          className="card"
          style={{
            background: 'var(--panel-2)',
            padding: 22,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 380,
              background: '#fff',
              color: '#111',
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          >
            {/* header band */}
            <div style={{ background: '#0f0f0f', color: '#fff', padding: '16px 20px', fontSize: 17, fontWeight: 800 }}>
              {isYtTheme ? (
                <span>
                  YT <span style={{ color: activeTheme.brandColor }}>Transcriber</span>
                </span>
              ) : (
                <span>{activeTheme.name}</span>
              )}
            </div>

            {/* body */}
            <div style={{ padding: '22px 20px' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 12, lineHeight: 1.35 }}>
                {tpl.subject}
              </div>
              <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.6, marginBottom: 22 }}>
                {tpl.body}
              </div>
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: activeTheme.brandColor,
                    color: '#fff',
                    padding: '11px 22px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  Accept invite
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#999', borderTop: '1px solid #eee', paddingTop: 14, lineHeight: 1.5 }}>
                {activeTheme.footer} · notifications@send.bentech.dev
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — controls rail */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={fieldLabel}>Subject</label>
            <input
              className="input"
              defaultValue={tpl.subject}
            />
          </div>

          <div>
            <label style={fieldLabel}>Preheader</label>
            <input
              className="input"
              defaultValue={tpl.preheader}
            />
          </div>

          <div>
            <label style={fieldLabel}>Variables</label>
            <div
              className="row wrap"
              style={{
                gap: 6,
                background: 'var(--panel-2)',
                border: '1px solid var(--border-soft)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              {tpl.variables.map((v) => (
                <code
                  key={v}
                  style={{
                    fontSize: 11,
                    fontFamily: "'Cascadia Code', Consolas, monospace",
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 5,
                    padding: '2px 6px',
                    color: 'var(--text)',
                  }}
                >
                  {v}
                </code>
              ))}
            </div>
          </div>

          <div>
            <label style={fieldLabel}>Body</label>
            <textarea
              className="textarea"
              defaultValue={tpl.body}
              style={{
                fontFamily: "'Cascadia Code', Consolas, monospace",
                fontSize: 12,
                minHeight: 70,
              }}
            />
          </div>

          <button className="btn ghost" style={{ width: '100%' }}>Send test to me</button>
        </div>
      </div>

      <Link className="link mt" href="/settings/email" style={{ display: 'inline-block', marginTop: 16 }}>
        ← Back to email
      </Link>
    </div>
  );
}
