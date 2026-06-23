'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Horizontal sub-nav for the Email management area. Overview also stays active
// across the /templates/* detail routes; the rest light up on prefix match.
const TABS = [
  { href: '/settings/email', label: 'Overview' },
  { href: '/settings/email/themes', label: 'Themes' },
  { href: '/settings/email/activity', label: 'Activity' },
  { href: '/settings/email/config', label: 'Configuration' },
];

export default function EmailNav() {
  const pathname = usePathname() ?? '';

  function isActive(href: string): boolean {
    if (href === '/settings/email') {
      return pathname === '/settings/email' || pathname.startsWith('/settings/email/templates');
    }
    return pathname.startsWith(href);
  }

  return (
    <div className="row mb" style={{ gap: 8 }}>
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`chip${isActive(t.href) ? ' on' : ''}`}
          style={{ textDecoration: 'none' }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
