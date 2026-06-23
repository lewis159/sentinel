import Link from 'next/link';
import { requireGlobalAdminPage } from '@/lib/auth';
import EmailNav from '@/components/EmailNav';
import { getEmailTheme } from '@/lib/email-portal';

export const dynamic = 'force-dynamic';

const field: React.CSSProperties = {
  width: '100%',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '10px 12px',
  color: 'var(--text)',
  fontSize: 13,
};

export default async function EmailThemeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireGlobalAdminPage();
  const { id } = await params;
  const { data: t } = await getEmailTheme(id);

  if (!t) {
    return (
      <div>
        <div className="card mb">Theme not found</div>
        <Link className="link" href="/settings/email/themes">← Back to themes</Link>
      </div>
    );
  }

  const dark = t.headerStyle === 'dark';

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">{t.name}</div>
          <div className="sub">Theme editor</div>
        </div>
        <div className="row">
          <button className="btn">Save theme</button>
        </div>
      </div>

      <EmailNav />

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr', gap: 14 }}>
        {/* LEFT — controls */}
        <div>
          <div className="sub mb">Theme name</div>
          <input style={field} defaultValue={t.name} />

          <div className="sub mb" style={{ marginTop: 14 }}>Brand colour</div>
          <div className="row" style={{ gap: 8 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: t.brandColor,
                border: '1px solid var(--border)',
                flexShrink: 0,
              }}
            />
            <input
              style={{ ...field, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              defaultValue={t.brandColor}
            />
          </div>

          <div className="sub mb" style={{ marginTop: 14 }}>Logo</div>
          <div
            className="spread"
            style={{
              border: '1px dashed var(--border)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 16 }}>🖼</span>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{t.logo}</span>
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 16 }}>⬆</span>
          </div>

          <div className="sub mb" style={{ marginTop: 14 }}>Header style</div>
          <div className="row" style={{ gap: 8 }}>
            <span className={`chip${dark ? ' on' : ''}`}>Dark</span>
            <span className={`chip${!dark ? ' on' : ''}`}>Light</span>
          </div>

          <div className="sub mb" style={{ marginTop: 14 }}>Footer</div>
          <textarea style={{ ...field, minHeight: 64, resize: 'vertical' }} defaultValue={t.footer} />
        </div>

        {/* RIGHT — live preview */}
        <div
          style={{
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              width: 330,
              background: '#fff',
              color: '#111',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          >
            {/* header band */}
            <div
              style={{
                background: dark ? '#0f0f0f' : '#fff',
                color: dark ? '#fff' : '#111',
                borderBottom: dark ? 'none' : '1px solid #eee',
                padding: '14px 18px',
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              <span style={{ borderLeft: `3px solid ${t.brandColor}`, paddingLeft: 8 }}>
                {t.name} · {t.app}
              </span>
            </div>

            {/* body */}
            <div style={{ padding: '18px' }}>
              <div style={{ color: '#111', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                Sample heading
              </div>
              <div style={{ color: '#555', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                The brand colour drives the header accent and the primary button below, so every
                template that adopts this theme stays on-brand.
              </div>
              <div style={{ textAlign: 'center', marginBottom: 18 }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: t.brandColor,
                    color: '#fff',
                    borderRadius: 6,
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Primary button
                </span>
              </div>
              <div
                style={{
                  color: '#999',
                  fontSize: 11,
                  borderTop: '1px solid #eee',
                  paddingTop: 12,
                }}
              >
                {t.footer}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt">
        <Link className="link" href="/settings/email/themes">← Back to themes</Link>
      </div>
    </div>
  );
}
