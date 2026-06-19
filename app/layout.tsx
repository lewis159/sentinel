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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
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
