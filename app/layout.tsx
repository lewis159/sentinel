import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sentinel — Operations & Security Console',
  description: 'Internal single-pane ops & security console.',
};

// Runs before first paint: applies the persisted theme to <html> so there's
// no light/dark flash. Falls back to 'dark'. The DB value is reconciled after
// hydration by <ThemeSwitcher>. Kept dependency-free and inline on purpose.
const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('sentinel.theme');var ok=['dark','light','midnight','slate'];document.documentElement.dataset.theme=(t&&ok.indexOf(t)>-1)?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

// v1 is retired. Every operator path either lives under /v2 (which supplies its
// own shell via app/v2/layout.tsx) or under /portal (its own shell via
// app/portal/layout.tsx); all legacy v1 paths 308-redirect to v2 in the
// middleware. So the root layout only ever wraps v2/portal children and renders
// them bare — no v1 sidebar/topbar/command-palette and no "Switch to v2" FAB.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" data-theme="dark" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
