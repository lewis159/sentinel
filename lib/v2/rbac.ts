// Sentinel v2 — RBAC core (section-level access control).
//
// PURE module: no server-only imports. Safe to import from both client and
// server components. Server-side session reading lives in `@/lib/auth`
// (getSessionAccess / requireSectionPage / requireSectionApi), which layers on
// top of the pure helpers here.
//
// Model: each Clerk user has `publicMetadata.role` (string) and optionally
// `publicMetadata.sections` (string[]) — an explicit per-user override of the
// granted sections. Access is gated at 6 top-level sections; `global_admin`
// always gets every section.

export type Section =
  | 'overview'
  | 'support'
  | 'operations'
  | 'security'
  | 'admin'
  | 'hermes';

export const ALL_SECTIONS: Section[] = [
  'overview',
  'support',
  'operations',
  'security',
  'admin',
  'hermes',
];

// Role presets → default granted sections. 'overview' is implicitly always
// granted (unioned in by resolveSections), so it need not be repeated, but is
// listed here for clarity.
export const ROLE_PRESETS: Record<string, Section[]> = {
  global_admin: ALL_SECTIONS,
  ops_manager: ['overview', 'operations', 'admin'],
  sre: ['overview', 'operations'],
  security_analyst: ['overview', 'security'],
  support_lead: ['overview', 'support'],
  support_agent: ['overview', 'support'],
  viewer: ['overview'],
};

// Human labels for each preset key — used by the admin UI.
export const PRESET_LABELS: Record<string, string> = {
  global_admin: 'Global admin',
  ops_manager: 'Ops manager',
  sre: 'SRE',
  security_analyst: 'Security analyst',
  support_lead: 'Support lead',
  support_agent: 'Support agent',
  viewer: 'Viewer',
};

const SECTION_SET = new Set<string>(ALL_SECTIONS);

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && SECTION_SET.has(value);
}

/**
 * Resolve the set of sections a user can access.
 *
 * - `global_admin` always gets every section.
 * - Otherwise, start from the explicit override (if a valid array) else the
 *   role preset (if any).
 * - 'overview' is always unioned in.
 * - Result is de-duped and contains only valid Section values, in ALL_SECTIONS
 *   order.
 */
export function resolveSections(
  role: string | undefined,
  override?: readonly string[] | null,
): Section[] {
  if (role === 'global_admin') return [...ALL_SECTIONS];

  const base: Section[] = Array.isArray(override)
    ? override.filter(isSection)
    : ROLE_PRESETS[role ?? ''] ?? [];

  const granted = new Set<Section>(base);
  granted.add('overview');

  // Return in canonical ALL_SECTIONS order, de-duped, valid-only.
  return ALL_SECTIONS.filter((s) => granted.has(s));
}

/**
 * True if the user (role + optional override) can access `section`.
 */
export function hasSection(
  role: string | undefined,
  override: readonly string[] | null | undefined,
  section: Section,
): boolean {
  return resolveSections(role, override).includes(section);
}

/**
 * Map a pathname to the top-level section that gates it.
 *
 * Strips a leading `/v2`, takes the first path segment, and maps it to a
 * Section. Unknown segments fall back to 'overview' (the always-granted
 * landing section).
 */
export function sectionForPath(pathname: string): Section {
  // Strip a leading /v2 (with or without trailing content).
  let path = pathname;
  if (path === '/v2') path = '/';
  else if (path.startsWith('/v2/')) path = path.slice(3); // keep leading slash

  const segs = path.replace(/^\/+/, '').split('/');
  const seg = segs[0] ?? '';

  // Admin-gated pages that live under another top-level segment for URL grouping.
  // The Integrations page sits under /hermes/ for nav placement but is gated by
  // the 'admin' section (it manages estate secrets + flags), so map it explicitly.
  if (seg === 'hermes' && segs[1] === 'integrations') return 'admin';

  switch (seg) {
    case '':
    case 'overview':
      return 'overview';

    case 'support':
      return 'support';

    case 'operations':
    case 'incidents':
    case 'requests':
    case 'changes':
    case 'problems':
    case 'releases':
    case 'components':
    case 'scans':
    case 'resilience':
    case 'alerts':
    case 'activity':
    case 'roadmap':
    case 'changelog':
    case 'testing':
      return 'operations';

    case 'security':
    case 'reports':
      return 'security';

    case 'admin':
    case 'access':
      return 'admin';

    case 'hermes':
      return 'hermes';

    case 'kb':
    case 'graph':
      return 'overview';

    case 'settings':
      return 'admin';

    default:
      return 'overview';
  }
}
