'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { NAV, UTILITIES } from '@/lib/v2/nav';
import { resolveSections, sectionForPath, type Section } from '@/lib/v2/rbac';

type NavItem = { label: string; href: string; icon: string };

// Minimal inline line icons keyed by NavItem.icon. Stroke = currentColor.
function icon(key: string) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (key) {
    case 'overview':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'support':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M5 5l3.2 3.2M15.8 15.8L19 19M19 5l-3.2 3.2M8.2 15.8L5 19" />
        </svg>
      );
    case 'operations':
      return (
        <svg {...common}>
          <path d="M3 12h4l3 8 4-16 3 8h4" />
        </svg>
      );
    case 'security':
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6z" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="3" />
          <path d="M3 20c0-2.8 2.2-5 5-5s5 2.2 5 5" />
          <circle cx="17.5" cy="8.5" r="2" />
          <path d="M19.5 8.5h2M17.5 10.5v4l1.2 1.2-1.2 1.2" />
        </svg>
      );
    case 'floor':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" />
          <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10" />
        </svg>
      );
    case 'approvals':
      return (
        <svg {...common}>
          <path d="M4 13h4l2 3h4l2-3h4" />
          <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
        </svg>
      );
    case 'agents':
      return (
        <svg {...common}>
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M12 8V4M9 13h.01M15 13h.01" />
        </svg>
      );
    case 'kb':
      return (
        <svg {...common}>
          <path d="M12 6c-1.6-1.2-4-2-6.5-2C4.7 4 4 4.7 4 5.5v12c0 .8.7 1.3 1.5 1.3C8 18.8 10.4 19.5 12 20.5" />
          <path d="M12 6c1.6-1.2 4-2 6.5-2 .8 0 1.5.7 1.5 1.5v12c0 .8-.7 1.3-1.5 1.3-2.5 0-4.9.7-6.5 1.7" />
          <path d="M12 6v14.5" />
        </svg>
      );
    case 'graph':
      return (
        <svg {...common}>
          <circle cx="5" cy="6" r="2.5" />
          <circle cx="19" cy="9" r="2.5" />
          <circle cx="9" cy="18" r="2.5" />
          <path d="M7.2 7.2l9.6 1.6M8 15.8l9.8-5.4" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M4 20h16" />
          <rect x="5" y="11" width="3" height="7" rx="0.5" />
          <rect x="10.5" y="6" width="3" height="12" rx="0.5" />
          <rect x="16" y="14" width="3" height="4" rx="0.5" />
        </svg>
      );
    case 'changes':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M4 9h16M8 3v4M16 3v4" />
        </svg>
      );
    case 'testing':
      return (
        <svg {...common}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
        </svg>
      );
    case 'customers':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
          <path d="M16 6.5a3 3 0 0 1 0 6M17.5 20c0-2.4-1.2-4.2-3-4.8" />
        </svg>
      );
    case 'incidents':
      return (
        <svg {...common}>
          <path d="M12 3.5 22 20H2z" />
          <path d="M12 10v4M12 17.5h.01" />
        </svg>
      );
    case 'requests':
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5M10 13h6M10 17h6" />
        </svg>
      );
    case 'problems':
      return (
        <svg {...common}>
          <path d="M11 4a2 2 0 0 1 4 0c0 1.4-1 1.6-1 3h-3v-1c0-1 0-1.5 0-2z" />
          <path d="M8 8H5a2 2 0 0 0 0 4h.5A2 2 0 0 1 5 15v3h3a2 2 0 0 0 4 0h4v-3a2 2 0 0 1 2-2 2 2 0 0 0 0-4h-3" />
        </svg>
      );
    case 'releases':
      return (
        <svg {...common}>
          <path d="M12 3c3.5 2 5 5.5 5 9l-5 4-5-4c0-3.5 1.5-7 5-9z" />
          <circle cx="12" cy="10" r="1.8" />
          <path d="M9 17l-2 4M15 17l2 4M10.5 18.5h3" />
        </svg>
      );
    case 'components':
      return (
        <svg {...common}>
          <path d="M12 3l7 4v8l-7 4-7-4V7z" />
          <path d="M12 3v8l7 4M12 11L5 15" />
        </svg>
      );
    case 'scans':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
        </svg>
      );
    case 'alerts':
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'activity':
      return (
        <svg {...common}>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case 'roadmap':
      return (
        <svg {...common}>
          <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case 'changelog':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 8h4M9 12h7M9 16h7" />
        </svg>
      );
    case 'apps':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'orgs':
      return (
        <svg {...common}>
          <path d="M4 21V7l7-3v17M11 21V9l7 3v9" />
          <path d="M7 9h.01M7 13h.01M14 13h.01M14 17h.01" />
        </svg>
      );
    case 'forecasting':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
          <path d="M19 9h-4M19 9v4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

export default function SidebarV2({
  // TEST-ONLY (double-gated in app/v2/layout.tsx): server-resolved granted
  // sections for the E2E shim, where there is no Clerk session to read on the
  // client. `undefined` in production → the existing client-side RBAC path runs
  // unchanged.
  grantedOverride,
}: {
  grantedOverride?: Section[];
} = {}) {
  const pathname = usePathname();

  // RBAC: hide sections the signed-in user can't access. While Clerk is still
  // loading we render the full nav to avoid a hide-flash, then filter once
  // `isLoaded` is true.
  const { user, isLoaded } = useUser();
  const role = user?.publicMetadata?.role as string | undefined;
  const sections = user?.publicMetadata?.sections as string[] | undefined;
  const grantedClient = useMemo(() => resolveSections(role, sections), [role, sections]);
  const granted = grantedOverride ?? grantedClient;

  // A nav item is visible if its section is granted. Before load, show all —
  // unless a server override is supplied (E2E), which is authoritative.
  const canSee = (item: NavItem) =>
    grantedOverride
      ? granted.includes(sectionForPath(item.href))
      : !isLoaded || granted.includes(sectionForPath(item.href));

  const active = (href: string) => {
    if (href === '/v2') return pathname === '/v2';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderLink = (item: NavItem, indent = false) => (
    <Link
      key={item.href}
      href={item.href}
      className={`v2-nav-link ${indent ? 'v2-nav-child' : ''} ${active(item.href) ? 'on' : ''}`}
      aria-current={active(item.href) ? 'page' : undefined}
    >
      <span className="ic">{icon(item.icon)}</span>
      <span>{item.label}</span>
    </Link>
  );

  // Accordion: only one collapsible group open at a time. Default to the group
  // that owns the active route so deep-links land expanded.
  const activeGroup = NAV.find(
    (g) => g.collapsible && g.items.some((it) => active(it.href)),
  )?.group;
  const [open, setOpen] = useState<string | null>(activeGroup ?? null);
  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  return (
    <aside className="v2-rail">
      <div className="v2-brand">
        <svg width={30} height={30} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="v2sgm" x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#5AA9FF" />
              <stop offset="0.5" stopColor="#2D6CFF" />
              <stop offset="1" stopColor="#1B4DD1" />
            </linearGradient>
          </defs>
          <path d="M32 3.5 L55 13.5 V31 C55 45 45 54.5 32 60.5 C19 54.5 9 45 9 31 V13.5 Z" fill="url(#v2sgm)" />
          <g stroke="#EAF3FF" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.95">
            <path d="M22.5 38 A13 13 0 0 1 32 17" />
            <path d="M26.5 38.5 A8.5 8.5 0 0 1 32 23.5" />
          </g>
          <circle cx="32" cy="30" r="4.2" fill="#EAF3FF" />
          <circle cx="32" cy="30" r="1.9" fill="#1B4DD1" />
        </svg>
        <span className="nm">
          SENTINEL
          <small>OPS CONSOLE</small>
        </span>
      </div>

      <div className="v2-who">
        <span className="av">BP</span>
        <span className="nm">
          Ben Percival
          <small>Global admin</small>
        </span>
      </div>

      <nav className="v2-nav">
        {NAV.map((grp, i) => {
          // Filter to the items this user may see; drop the whole group if none.
          const items = (grp.items as NavItem[]).filter(canSee);
          if (items.length === 0) return null;

          // Ungrouped → plain pinned links.
          if (!grp.group) {
            return <div key={i}>{items.map((it) => renderLink(it))}</div>;
          }

          // Collapsible → accordion header that toggles its children.
          if (grp.collapsible) {
            const isOpen = open === grp.group;
            return (
              <div key={i}>
                <button
                  type="button"
                  className={`v2-nav-acc ${isOpen ? 'open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : grp.group!)}
                >
                  <span>{grp.group}</span>
                  <span className="v2-nav-caret" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </button>
                {isOpen && items.map((it) => renderLink(it, true))}
              </div>
            );
          }

          // Static labelled group → always-visible links under a label.
          return (
            <div key={i}>
              <div className="v2-nav-label">{grp.group}</div>
              {items.map((it) => renderLink(it))}
            </div>
          );
        })}
      </nav>

      <nav className="v2-util">
        <div className="v2-nav-label">Everywhere</div>
        {(UTILITIES as NavItem[]).filter(canSee).map((it) => renderLink(it))}
      </nav>
    </aside>
  );
}
