'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WORKSPACES, inferWorkspace, type Workspace } from '@/lib/nav';
import { Mark } from './Brand';

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [ws, setWs] = useState<Workspace>(() => inferWorkspace(path) ?? 'security');

  // Landing on a route uniquely owned by the other workspace switches to it.
  useEffect(() => {
    const owned = inferWorkspace(path);
    if (owned && owned !== ws) setWs(owned);
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  const switchTo = (target: Workspace) => {
    setWs(target);
    router.push(WORKSPACES[target].home);
  };

  // Accordion: track which collapsible group is open. Default to the group that
  // contains the active route so deep-links land expanded.
  const groups = WORKSPACES[ws].nav;
  const activeGroup = groups.find((g) => g.collapsible && g.items.some((it) => isActive(it.href)))?.group;
  const [open, setOpen] = useState<string | null>(activeGroup ?? null);
  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <Mark size={30} />
        <span className="name">SENTINEL<small>OPS &amp; SECURITY</small></span>
      </Link>

      {/* Workspace switch */}
      <div className="ws-switch">
        {(['security', 'operations'] as Workspace[]).map((w) => (
          <button key={w} className={`ws-btn ${ws === w ? 'on' : ''}`} onClick={() => switchTo(w)}>
            <span>{WORKSPACES[w].icon}</span> {WORKSPACES[w].label}
          </button>
        ))}
      </div>

      <nav className="nav">
        {groups.map((grp, i) => {
          const links = grp.items.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(item.href) ? 'active' : ''}>
              <span className="ic">{item.icon}</span>
              {item.label}
            </Link>
          ));

          if (grp.collapsible && grp.group) {
            const isOpen = open === grp.group;
            return (
              <div key={i}>
                <button
                  type="button"
                  className={`group acc ${isOpen ? 'open' : ''}`}
                  onClick={() => setOpen(isOpen ? null : grp.group!)}
                >
                  <span>{grp.group}</span>
                  <span className="acc-caret">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && links}
              </div>
            );
          }

          return (
            <div key={i}>
              {grp.group && <div className="group">{grp.group}</div>}
              {links}
            </div>
          );
        })}
      </nav>

      <div className="nav" style={{ marginTop: 'auto', paddingTop: 12 }}>
        <Link href="/graph" className={isActive('/graph') ? 'active' : ''}><span className="ic">⌗</span>Graph</Link>
        <Link href="/settings" className={isActive('/settings') ? 'active' : ''}><span className="ic">⚙</span>Settings</Link>
      </div>
    </aside>
  );
}
