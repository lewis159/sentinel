// Sentinel navigation — two workspaces (Security / Operations) in one app.
export type NavItem = { label: string; href: string; icon: string };
export type NavGroup = { group?: string; items: NavItem[] };
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
          { label: 'User Audit', href: '/users', icon: '◰' },
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
const OWNS: Record<string, Workspace> = {
  findings: 'security', tickets: 'security', users: 'security', incidents: 'security',
  infra: 'operations', components: 'operations', activity: 'operations', resilience: 'operations',
};

export function inferWorkspace(pathname: string): Workspace | null {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return OWNS[seg] ?? null;
}
