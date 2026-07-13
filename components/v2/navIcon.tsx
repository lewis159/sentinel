// Shared inline line-icons keyed by a short string (NavItem.icon / group icon).
// Server-safe (no 'use client'): returns a plain <svg> so it can be used from
// both the client SidebarV2 and server-rendered pages (e.g. the Hermes hub).
// Stroke = currentColor; `size` overrides the default 17px box.

import type { JSX } from 'react';

export function navIcon(key: string, size = 17): JSX.Element {
  const common = {
    width: size,
    height: size,
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
    case 'plug':
      return (
        <svg {...common}>
          <path d="M9 2v6M15 2v6" />
          <path d="M7 8h10v3a5 5 0 0 1-10 0z" />
          <path d="M12 16v6" />
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

    // --- Hermes hub + themed group headers -------------------------------
    case 'hub': // Hermes brain
      return (
        <svg {...common}>
          <path d="M9 4.5A2.5 2.5 0 0 0 6.5 7 2.5 2.5 0 0 0 5 11.5 2.5 2.5 0 0 0 7 16v.5A2.5 2.5 0 0 0 9.5 19 2.5 2.5 0 0 0 12 16.5V5.5A2.5 2.5 0 0 0 9 4.5z" />
          <path d="M15 4.5A2.5 2.5 0 0 1 17.5 7 2.5 2.5 0 0 1 19 11.5 2.5 2.5 0 0 1 17 16v.5A2.5 2.5 0 0 1 14.5 19 2.5 2.5 0 0 1 12 16.5" />
        </svg>
      );
    case 'cpu': // command group
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
          <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
        </svg>
      );
    case 'trending-up': // growth group
      return (
        <svg {...common}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      );
    case 'book': // knowledge group
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
          <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
        </svg>
      );
    case 'server-cog': // ops group
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <path d="M7 7h.01M3 12v4a2 2 0 0 0 2 2h5" />
          <circle cx="17" cy="17" r="2.5" />
          <path d="M17 13.5v-1M17 21.5v-1M20.5 17h1M12.5 17h1M19.5 14.5l.7-.7M14.1 19.9l-.7.7M19.5 19.5l.7.7M14.1 14.1l-.7-.7" />
        </svg>
      );
    case 'agent-builder': // wand / build an agent
      return (
        <svg {...common}>
          <path d="M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
          <path d="M4 20l9-9M11 6.5 8.5 4" />
        </svg>
      );
    case 'governance': // dials / sliders
      return (
        <svg {...common}>
          <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h13M21 18h-1" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="19" cy="18" r="2" />
        </svg>
      );
    case 'churn': // heart with a slash (save at-risk)
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.3-9-9a4.5 4.5 0 0 1 8-3" />
          <path d="M12 8a4.5 4.5 0 0 1 8 3c-.6 1.4-1.6 2.7-2.7 3.9" />
          <path d="M4 4l16 16" />
        </svg>
      );
    case 'onboarding': // user plus
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
          <path d="M18 8v6M15 11h6" />
        </svg>
      );
    case 'leads': // target / prospect
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'health': // heartbeat pulse
      return (
        <svg {...common}>
          <path d="M3 12h3l2-5 3 10 2.5-7 1.5 2h3.5" />
          <path d="M18.5 8.5A3 3 0 0 0 14 8" opacity="0.6" />
        </svg>
      );
    case 'board': // presentation / board update
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M12 16v4M8 20h8M8 12l2.5-3 2 2L16 8" />
        </svg>
      );
    case 'knowledge': // message with question
      return (
        <svg {...common}>
          <path d="M4 5h16v11H9l-4 4V5z" />
          <path d="M9.5 9a2.5 2.5 0 0 1 3.5 2c0 1.2-1.2 1.5-1.2 2.5M12 15.5h.01" />
        </svg>
      );
    case 'kb-authoring': // pencil on a document
      return (
        <svg {...common}>
          <path d="M6 3h7l5 5v6" />
          <path d="M13 3v5h5M8 12h4" />
          <path d="M19.5 15.5l2 2L16 23H14v-2z" />
        </svg>
      );
    case 'feature-requests': // lightbulb / idea
      return (
        <svg {...common}>
          <path d="M9 17.5a5.5 5.5 0 1 1 6 0V19H9z" />
          <path d="M9.5 21h5M10 19h4" />
        </svg>
      );
    case 'market': // megaphone
      return (
        <svg {...common}>
          <path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z" />
          <path d="M18 8.5a4 4 0 0 1 0 7" />
        </svg>
      );
    case 'incident-commander': // command shield with alert
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 21 4 18 4 12V6z" />
          <path d="M12 8.5v4M12 15.5h.01" />
        </svg>
      );
    case 'observability': // gauge
      return (
        <svg {...common}>
          <path d="M4 19a8 8 0 1 1 16 0" />
          <path d="M12 19l4-5" />
          <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'resilience': // shield with check
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 21 4 18 4 12V6z" />
          <path d="M9 12l2 2 4-4" />
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
