// Estate app registry — the single declarative list of apps whose per-user
// access Sentinel manages. Adding an estate app is a one-line change here:
// it appears in the User Access UI and is accepted by the access write API.
//
// `metered` flags apps that have a usage quota (e.g. YT's transcription limit);
// those surface a "Request limit increase" action that opens a service-request
// ticket in the ITIL module rather than a direct level change.

export const ACCESS_LEVELS = ['none', 'viewer', 'admin'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  none: 'No access',
  viewer: 'Viewer',
  admin: 'Admin',
};

// Per-app roles (Phase 1: Sentinel uses these via the `app_role` column). NOTE:
// these DO NOT yet change the authorization gate — every gate still checks the
// Clerk global_admin role (see lib/auth.ts). app_role is provisioned + settable
// now so the gate can switch to reading it in a later phase.
export const APP_ROLES = ['viewer', 'responder', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABEL: Record<AppRole, string> = {
  viewer: 'Viewer',
  responder: 'Responder',
  admin: 'Admin',
};

// How an app's per-user access is controlled, which drives the UI control:
//   'role'         → Sentinel: pick an app_role (viewer/responder/admin).
//   'level'        → Bruce: the existing none/viewer/admin access level.
//   'tier-readonly'→ YT: tier + quota are owned by YT's DB; Sentinel shows them
//                    read-only (from ops.app_entitlements) and offers request-only.
export type AccessControl = 'role' | 'level' | 'tier-readonly';

// Which system OWNS (is authoritative for) an app's access state. Sentinel only
// WRITES rows it owns; YT-owned writes are rejected in Phase 1 (display + request).
export type AccessSource = 'sentinel' | 'bruce' | 'yt';

export type EstateAppDef = {
  id: string; // stable key used in the DB / Clerk metadata map
  name: string; // display name
  subdomain: string;
  metered: boolean; // has a usage quota a user can request more of
  metricLabel?: string; // e.g. 'Monthly transcription limit'
  ticketApp: 'YT' | 'Sentinel' | 'Bruce' | 'Estate'; // maps to ITIL ticket `app`
  accessControl: AccessControl; // which control the access UI renders
  source: AccessSource; // owning system / source of truth for this app's access
  quotaPeriod?: string; // e.g. 'month' — for metered/tier-readonly apps
};

export const ESTATE_APPS: EstateAppDef[] = [
  {
    id: 'yt',
    name: 'YT Transcriber',
    subdomain: 'yt.bentech.dev',
    metered: true,
    metricLabel: 'Monthly transcription limit',
    ticketApp: 'YT',
    accessControl: 'tier-readonly',
    source: 'yt',
    quotaPeriod: 'month',
  },
  {
    id: 'bruce',
    name: 'Bruce Springsteen News',
    subdomain: 'bruce.bentech.dev',
    metered: false,
    ticketApp: 'Bruce',
    accessControl: 'level',
    source: 'bruce',
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    subdomain: 'ops.bentech.dev',
    metered: false,
    ticketApp: 'Sentinel',
    accessControl: 'role',
    source: 'sentinel',
  },
];

export const APP_IDS = ESTATE_APPS.map((a) => a.id);

export function getApp(id: string): EstateAppDef | undefined {
  return ESTATE_APPS.find((a) => a.id === id);
}

export function isValidApp(id: string): boolean {
  return ESTATE_APPS.some((a) => a.id === id);
}

export function isValidLevel(level: string): level is AccessLevel {
  return (ACCESS_LEVELS as readonly string[]).includes(level);
}

export function isValidAppRole(role: string): role is AppRole {
  return (APP_ROLES as readonly string[]).includes(role);
}

// True for apps Sentinel itself owns and may write directly (Sentinel, Bruce).
// YT (source 'yt') is display + request-only in Phase 1.
export function isOpsOwned(id: string): boolean {
  const def = getApp(id);
  return !!def && def.source !== 'yt';
}
