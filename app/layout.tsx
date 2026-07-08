import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { Trail } from '@/components/Trail';
import { CommandPalette } from '@/components/CommandPalette';

export const metadata: Metadata = {
  title: 'Sentinel — Operations & Security Console',
  description: 'Internal single-pane ops & security console.',
};

// Runs before first paint: applies the persisted theme to <html> so there's
// no light/dark flash. Falls back to 'dark'. The DB value is reconciled after
// hydration by <ThemeSwitcher>. Kept dependency-free and inline on purpose.
const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('sentinel.theme');var ok=['dark','light','midnight','slate'];document.documentElement.dataset.theme=(t&&ok.indexOf(t)>-1)?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Additive: requests under /v2 are tagged with x-sentinel-shell=v2 by the
  // middleware. v2 supplies its own shell (sidebar/topbar) via app/v2/layout.tsx,
  // so here we render {children} bare. All other paths get the untouched v1 shell.
  const h = await headers();
  const isV2 = h.get('x-sentinel-shell') === 'v2';
  return (
    <ClerkProvider>
      <html lang="en" data-theme="dark" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        </head>
        <body>
          {isV2 ? (
            children
          ) : (
            <div className="shell">
              <Sidebar />
              <div className="main">
                <TopBar />
                <Trail />
                <main className="content">{children}</main>
              </div>
            </div>
          )}
          {!isV2 && <CommandPalette />}
          {!isV2 && (
            // Additive v1→v2 switch. v2 supplies its own v2→v1 toggle in its topbar.
            <a
              href="/v2"
              style={{
                position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#2D6CFF', color: '#fff', padding: '9px 15px',
                borderRadius: 22, fontSize: 13, fontWeight: 600,
                boxShadow: '0 6px 20px rgba(0,0,0,.45)', textDecoration: 'none',
                fontFamily: "'Segoe UI', system-ui, sans-serif",
              }}
            >
              Switch to v2 →
            </a>
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
