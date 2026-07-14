'use client';

import { usePathname } from 'next/navigation';
import RefreshControl from '@/components/v2/RefreshControl';
import CommandPalette, { OPEN_CMDK_EVENT } from '@/components/v2/CommandPalette';

type Crumb = { section: string; sub?: string };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Turn a URL slug into a readable label, e.g. 'reset-your-password' → 'Reset your password'.
const titleize = (s: string) => cap(s.replace(/[-_]+/g, ' ').trim());

// Derive the breadcrumb (section + optional sub) from the current pathname.
// Static routes map directly; a couple of dynamic patterns are handled by segment.
function crumbFor(pathname: string): Crumb {
  const path = pathname.replace(/\/+$/, '') || '/v2';
  const segs = path.split('/').filter(Boolean); // e.g. ['v2', 'support', 'S-1024']

  const STATIC: Record<string, Crumb> = {
    '/v2': { section: 'Overview', sub: 'Estate' },
    '/v2/support': { section: 'Support', sub: 'Customer desk' },
    '/v2/operations': { section: 'Operations', sub: 'Monitoring' },
    '/v2/security': { section: 'Security', sub: 'Posture' },
    '/v2/admin': { section: 'Admin', sub: 'Access' },
    '/v2/hermes/floor': { section: 'Hermes', sub: 'Floor' },
    '/v2/hermes/approvals': { section: 'Hermes', sub: 'Approvals' },
    '/v2/hermes/agents': { section: 'Hermes', sub: 'Agents' },
    '/v2/settings': { section: 'Settings' },
    '/v2/kb': { section: 'Knowledge base' },
    '/v2/kb/drafts': { section: 'Knowledge base', sub: 'Drafts' },
    '/v2/graph': { section: 'Graph' },
    '/v2/reports': { section: 'Reports' },
    '/v2/changes': { section: 'Operations', sub: 'Change calendar' },
    '/v2/testing': { section: 'Operations', sub: 'Testing & gates' },
    '/v2/incidents': { section: 'Operations', sub: 'Incidents' },
  };

  if (STATIC[path]) return STATIC[path];

  // /v2/support/customers/{id} → Support / Customers (or the id)
  if (segs[1] === 'support' && segs[2] === 'customers') {
    return { section: 'Support', sub: segs[3] ? titleize(segs[3]) : 'Customers' };
  }
  // /v2/support/{ref} → Support / {REF}
  if (segs[1] === 'support' && segs[2]) {
    return { section: 'Support', sub: segs[2].toUpperCase() };
  }
  // /v2/settings/{x} → Settings / {x}
  if (segs[1] === 'settings' && segs[2]) {
    return { section: 'Settings', sub: segs[2] };
  }
  // /v2/kb/{slug} → Knowledge base / {Slug}
  if (segs[1] === 'kb' && segs[2]) {
    return { section: 'Knowledge base', sub: titleize(segs[2]) };
  }
  // /v2/incidents/{ref} → Operations / {REF}
  if (segs[1] === 'incidents' && segs[2]) {
    return { section: 'Operations', sub: segs[2].toUpperCase() };
  }
  // /v2/{requests|problems|releases}[/{ref}] → Operations / {Kind} [{REF}]
  if (segs[1] === 'requests' || segs[1] === 'problems' || segs[1] === 'releases') {
    const kind = cap(segs[1]);
    return { section: 'Operations', sub: segs[2] ? `${kind} ${segs[2].toUpperCase()}` : kind };
  }

  // Unknown route — capitalize the first meaningful segment after /v2.
  const first = segs[0] === 'v2' ? segs[1] : segs[0];
  return { section: first ? cap(first) : 'Overview' };
}

export default function TopBarV2() {
  const pathname = usePathname() ?? '/v2';
  const { section, sub } = crumbFor(pathname);
  const toggleTheme = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('sentinel.theme', next);
    } catch {
      /* ignore storage errors */
    }
  };

  return (
    <header className="v2-topbar">
      <div className="v2-crumb">
        <b>{section}</b>
        {sub && <span> / {sub}</span>}
      </div>

      <div
        className="v2-cmd"
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CMDK_EVENT))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent(OPEN_CMDK_EVENT));
          }
        }}
        aria-label="Open command palette"
      >
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Search or jump to&hellip;</span>
        <kbd>&#8984;K</kbd>
      </div>

      <RefreshControl />

      <button type="button" className="v2-tb-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>

      <CommandPalette />
    </header>
  );
}
