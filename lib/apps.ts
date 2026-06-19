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

export type EstateAppDef = {
  id: string; // stable key used in the DB / Clerk metadata map
  name: string; // display name
  subdomain: string;
  metered: boolean; // has a usage quota a user can request more of
  metricLabel?: string; // e.g. 'Monthly transcription limit'
  ticketApp: 'YT' | 'Sentinel' | 'Bruce' | 'Estate'; // maps to ITIL ticket `app`
};

export const ESTATE_APPS: EstateAppDef[] = [
  {
    id: 'yt',
    name: 'YT Transcriber',
    subdomain: 'yt.bentech.dev',
    metered: true,
    metricLabel: 'Monthly transcription limit',
    ticketApp: 'YT',
  },
  {
    id: 'bruce',
    name: 'Bruce Springsteen News',
    subdomain: 'bruce.bentech.dev',
    metered: false,
    ticketApp: 'Bruce',
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    subdomain: 'ops.bentech.dev',
    metered: false,
    ticketApp: 'Sentinel',
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
