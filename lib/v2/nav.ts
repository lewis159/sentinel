// v2 navigation model — data only. `icon` is a short string key that the sidebar
// maps to an inline SVG. Kept free of JSX so it can be imported from server or
// client components alike.

export type V2NavItem = { label: string; href: string; icon: string };

// A group of nav items. `group` is the section label; a group with no label
// renders as plain pinned links. `collapsible` groups render as accordions in
// the sidebar (only one open at a time) so the rail height stays manageable as
// the estate grows.
export type V2NavGroup = { group?: string; collapsible?: boolean; items: V2NavItem[] };

// Primary rail — every reachable v2 section, grouped.
export const NAV: V2NavGroup[] = [
  { items: [{ label: 'Overview', href: '/v2', icon: 'overview' }] },
  {
    group: 'Support',
    items: [
      { label: 'Desk', href: '/v2/support', icon: 'support' },
      { label: 'Needs human', href: '/v2/support/needs-human', icon: 'approvals' },
      { label: 'Customers', href: '/v2/support/customers', icon: 'customers' },
    ],
  },
  {
    group: 'Operations',
    collapsible: true,
    items: [
      { label: 'Monitoring', href: '/v2/operations', icon: 'operations' },
      { label: 'Incidents', href: '/v2/incidents', icon: 'incidents' },
      { label: 'Requests', href: '/v2/requests', icon: 'requests' },
      { label: 'Changes', href: '/v2/changes', icon: 'changes' },
      { label: 'Problems', href: '/v2/problems', icon: 'problems' },
      { label: 'Releases', href: '/v2/releases', icon: 'releases' },
      { label: 'Components', href: '/v2/components', icon: 'components' },
      { label: 'Scans', href: '/v2/scans', icon: 'scans' },
      { label: 'Resilience', href: '/v2/resilience', icon: 'security' },
      { label: 'Alerts', href: '/v2/alerts', icon: 'alerts' },
      { label: 'Activity', href: '/v2/activity', icon: 'activity' },
      { label: 'Roadmap', href: '/v2/roadmap', icon: 'roadmap' },
      { label: 'Changelog', href: '/v2/changelog', icon: 'changelog' },
      { label: 'Testing', href: '/v2/testing', icon: 'testing' },
    ],
  },
  {
    group: 'Security',
    items: [
      { label: 'Posture', href: '/v2/security', icon: 'security' },
      { label: 'Reports', href: '/v2/reports', icon: 'reports' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Access', href: '/v2/admin', icon: 'admin' },
      { label: 'Apps', href: '/v2/access/apps', icon: 'apps' },
      { label: 'Organizations', href: '/v2/access/orgs', icon: 'orgs' },
    ],
  },
  {
    group: 'Hermes',
    collapsible: true,
    items: [
      { label: 'Floor', href: '/v2/hermes/floor', icon: 'floor' },
      { label: 'Feature Requests', href: '/v2/hermes/feature-requests', icon: 'requests' },
      { label: 'Approvals', href: '/v2/hermes/approvals', icon: 'approvals' },
      { label: 'Observability', href: '/v2/hermes/observability', icon: 'activity' },
      { label: 'Agents', href: '/v2/hermes/agents', icon: 'agents' },
      { label: 'Knowledge Q&A', href: '/v2/hermes/knowledge', icon: 'kb' },
      { label: 'Integrations', href: '/v2/hermes/integrations', icon: 'plug' },
      { label: 'Testing', href: '/v2/hermes/testing', icon: 'testing' },
    ],
  },
];

// Utility / cross-cutting destinations, pinned to the bottom of the rail.
export const UTILITIES: V2NavItem[] = [
  { label: 'Knowledge base', href: '/v2/kb', icon: 'kb' },
  { label: 'Graph', href: '/v2/graph', icon: 'graph' },
  { label: 'Settings', href: '/v2/settings', icon: 'settings' },
];
