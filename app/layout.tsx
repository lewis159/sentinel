import type { Metadata } from 'next';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" data-theme="dark" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        </head>
        <body>
          <div className="shell">
            <Sidebar />
            <div className="main">
              <TopBar />
              <Trail />
              <main className="content">{children}</main>
            </div>
          </div>
          <CommandPalette />
        </body>
      </html>
    </ClerkProvider>
  );
}
