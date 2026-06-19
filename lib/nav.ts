// Sentinel navigation — two workspaces (Security / Operations) in one app.
export type NavItem = { label: string; href: string; icon: string };
// `collapsible` groups render as accordions in the Sidebar (only one open at a
// time) so the sidebar width stays fixed as the estate grows.
export type NavGroup = { group?: string; items: NavItem[]; collapsible?: boolean };
export type Workspace = 'security' | 'operations';

export const WORKSPACES: Record<Workspace, { label: string; icon: string; home: string; nav: NavGroup[] }> = {
  security: {
    label: 'Security',
    icon: '🛡',
    home: '/',
    nav: [
      { items: [{ label: 'Overview', href: '/', icon: '▦' }] },
      {
        group: 'Detect',
        items: [
          { label: 'Findings', href: '/findings', icon: '⚠' },
          { label: 'Scans & Checks', href: '/scans', icon: '◎' },
        ],
      },
      {
        group: 'Respond',
        items: [
          { label: 'Tickets', href: '/tickets', icon: '🎫' },
          { label: 'Alerts', href: '/alerts', icon: '🔔' },
          { label: 'Incidents', href: '/incidents', icon: '🚨' },
        ],
      },
      {
        group: 'Reference',
        items: [
          { label: 'Knowledge Base', href: '/kb', icon: '📘' },
          { label: 'Reports', href: '/reports', icon: '▤' },
        ],
      },
    ],
  },
  operations: {
    label: 'Operations',
    icon: '◷',
    home: '/infra',
    nav: [
      { items: [{ label: 'Overview', href: '/', icon: '▦' }] },
      {
        group: 'Infrastructure',
        items: [
          { label: 'Infra', href: '/infra', icon: '◷' },
          { label: 'Components', href: '/components', icon: '⬡' },
          { label: 'Resilience', href: '/resilience', icon: '🛡' },
          { label: 'Scans & Checks', href: '/scans', icon: '◎' },
        ],
      },
      {
        group: 'Service management',
        collapsible: true,
        items: [
          { label: 'Incidents', href: '/incidents', icon: '🚨' },
          { label: 'Requests', href: '/requests', icon: '📝' },
          { label: 'Changes', href: '/changes', icon: '🔧' },
          { label: 'Problems', href: '/problems', icon: '🧩' },
          { label: 'Releases', href: '/releases', icon: '🚀' },
        ],
      },
      {
        group: 'Access',
        items: [
          { label: 'User Access', href: '/users', icon: '👤' },
        ],
      },
      {
        group: 'Delivery',
        collapsible: true,
        items: [
          { label: 'Roadmap', href: '/roadmap', icon: '🗺' },
          { label: 'Changelog', href: '/changelog', icon: '🗒' },
        ],
      },
      {
        group: 'Signals',
        items: [
          { label: 'Alerts', href: '/alerts', icon: '🔔' },
          { label: 'Activity', href: '/activity', icon: '≣' },
        ],
      },
      {
        group: 'Reference',
        items: [
          { label: 'Knowledge Base', href: '/kb', icon: '📘' },
          { label: 'Reports', href: '/reports', icon: '▤' },
        ],
      },
    ],
  },
};

// Routes uniquely owned by one workspace — used to auto-switch when you land there.
// Service-management sections live in Operations (per the IA brief). `incidents`
// stays owned by Security for now (the Security/Ops IA review is a later pass).
const OWNS: Record<string, Workspace> = {
  findings: 'security', tickets: 'security', incidents: 'security',
  infra: 'operations', components: 'operations', activity: 'operations', resilience: 'operations',
  users: 'operations',
  requests: 'operations', changes: 'operations', problems: 'operations', releases: 'operations',
  roadmap: 'operations', changelog: 'operations',
};

export function inferWorkspace(pathname: string): Workspace | null {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return OWNS[seg] ?? null;
}
