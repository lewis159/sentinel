'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { NAV, UTILITIES } from '@/lib/v2/nav';
import { resolveSections, sectionForPath, type Section } from '@/lib/v2/rbac';
import { navIcon } from '@/components/v2/navIcon';

type NavItem = { label: string; href: string; icon: string };

// Icon rendering is shared with the Hermes hub (server component) via
// components/v2/navIcon.tsx so the two never drift.
const icon = (key: string) => navIcon(key);

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
                  <span className="v2-nav-acc-lab">
                    {grp.icon ? <span className="ic">{icon(grp.icon)}</span> : null}
                    {grp.group}
                  </span>
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
