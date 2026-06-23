// Data access for the Email management area (Settings → Email). Phase 1 is
// scaffolding only: there is NO email store yet, so every getter returns mock
// data with `live:false`. The public API mirrors the `Sourced<T>` shape used by
// lib/data.ts so the Phase 2 pages and a future DB-backed implementation can
// swap in without changing call sites.

export type Sourced<T> = { data: T; live: boolean; note?: string };

export type EmailStatus = 'active' | 'draft';

export type EmailTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: EmailStatus;
  apps: string[];
  themes: string[];
  sent30d: number;
  bounceRate: number;
  updatedLabel: string;
  subject: string;
  preheader: string;
  variables: string[];
  body: string;
};

export type EmailTheme = {
  id: string;
  name: string;
  app: string;
  brandColor: string;
  headerStyle: 'dark' | 'light';
  logo: string;
  footer: string;
};

export type EmailActivityEvent = {
  id: string;
  time: string;
  recipient: string;
  template: string;
  app: string;
  status: 'delivered' | 'opened' | 'bounced' | 'complaint' | 'sent';
};

export type EmailStats = {
  sent30d: number;
  deliveredPct: number;
  bounced: number;
  templates: number;
  openedPct: number;
  complaints: number;
};

export type EmailProvider = {
  name: string;
  connected: boolean;
  region: string;
  domain: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

export type EmailIdentity = { app: string; from: string; replyTo: string };

export type EmailNotificationSetting = {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
};

export type EmailSettings = {
  provider: EmailProvider;
  identities: EmailIdentity[];
  notifications: EmailNotificationSetting[];
  reminderDays: [number, number];
};

// Base path for the whole Email area — Phase 2 pages build links off this.
export const EMAIL_BASE = '/settings/email';

// Every getter currently returns mock data with this note (no DB store yet).
const MOCK_NOTE = 'mock — no email store yet';

function sourced<T>(data: T): Sourced<T> {
  return { data, live: false, note: MOCK_NOTE };
}

// ---------- Mock data ----------

const MOCK_STATS: EmailStats = {
  sent30d: 1284,
  deliveredPct: 98.6,
  bounced: 11,
  templates: 6,
  openedPct: 61,
  complaints: 1,
};

const MOCK_TEMPLATES: EmailTemplate[] = [
  {
    id: 'team-invite',
    name: 'Team invite',
    description: 'Sent when an admin invites a member to an org.',
    icon: '✉️',
    status: 'active',
    apps: ['YT', 'Sentinel'],
    themes: ['yt-red', 'sentinel-blue'],
    sent30d: 412,
    bounceRate: 0.4,
    updatedLabel: 'edited 2d ago',
    subject: "You're invited to join {{orgName}}",
    preheader: 'Accept to join your team',
    variables: ['{{orgName}}', '{{inviterName}}', '{{inviteUrl}}'],
    body: '{{inviterName}} invited you to the {{orgName}} workspace…',
  },
  {
    id: 'welcome',
    name: 'Welcome',
    description: 'First email a new user receives after signing up.',
    icon: '👋',
    status: 'active',
    apps: ['Default'],
    themes: ['default'],
    sent30d: 761,
    bounceRate: 1.1,
    updatedLabel: 'edited 9d ago',
    subject: 'Welcome to {{appName}}',
    preheader: "Let's get started",
    variables: ['{{appName}}', '{{firstName}}'],
    body: 'Welcome aboard, {{firstName}}…',
  },
  {
    id: 'invite-reminder',
    name: 'Invite reminder',
    description: 'Nudges a recipient whose invite is still pending.',
    icon: '⏰',
    status: 'active',
    apps: ['YT'],
    themes: ['yt-red'],
    sent30d: 88,
    bounceRate: 0.0,
    updatedLabel: 'edited 2d ago',
    subject: 'Reminder: your invitation to {{orgName}} is waiting',
    preheader: 'Your invite is still open',
    variables: ['{{orgName}}', '{{inviteUrl}}', '{{daysPending}}'],
    body: 'Your invite to {{orgName}} is still waiting…',
  },
  {
    id: 'seat-freed',
    name: 'Seat freed',
    description: 'Notifies admins when a seat opens up in an org.',
    icon: '🪑',
    status: 'active',
    apps: ['YT'],
    themes: ['yt-red'],
    sent30d: 23,
    bounceRate: 0.0,
    updatedLabel: 'edited 5d ago',
    subject: 'A seat just opened up in {{orgName}}',
    preheader: 'A seat is available',
    variables: ['{{orgName}}', '{{freedMemberEmail}}'],
    body: 'A seat just opened up in {{orgName}}…',
  },
  {
    id: 'share-notify',
    name: 'Share notify',
    description: 'Tells a teammate that a video was shared with them.',
    icon: '🔗',
    status: 'draft',
    apps: ['YT'],
    themes: ['yt-red'],
    sent30d: 0,
    bounceRate: 0,
    updatedLabel: 'edited 1h ago',
    subject: '{{sharerName}} shared "{{videoTitle}}" with you',
    preheader: 'A video was shared with you',
    variables: ['{{orgName}}', '{{sharerName}}', '{{videoTitle}}', '{{videoUrl}}'],
    body: '{{sharerName}} shared a video with you…',
  },
  {
    id: 'monthly-digest',
    name: 'Monthly digest',
    description: 'A monthly summary sent on the 1st.',
    icon: '📅',
    status: 'draft',
    apps: ['Default'],
    themes: ['default'],
    sent30d: 0,
    bounceRate: 0,
    updatedLabel: 'scheduled · 1st',
    subject: 'Your monthly summary',
    preheader: "Here's your month",
    variables: ['{{firstName}}'],
    body: "Here's what happened this month…",
  },
];

const MOCK_THEMES: EmailTheme[] = [
  { id: 'yt-red', name: 'YT red', app: 'YT', brandColor: '#E53935', headerStyle: 'dark', logo: 'yt-logo-light.png', footer: 'YT Transcriber · bentech.dev' },
  { id: 'sentinel-blue', name: 'Sentinel blue', app: 'Sentinel', brandColor: '#2D6CFF', headerStyle: 'dark', logo: 'sentinel-logo-light.png', footer: 'Sentinel · bentech.dev' },
  { id: 'default', name: 'Default', app: 'Default', brandColor: '#2D6CFF', headerStyle: 'light', logo: 'bentech-logo.png', footer: 'bentech.dev' },
];

const MOCK_ACTIVITY: EmailActivityEvent[] = [
  { id: 'ev-1', time: '14:02', recipient: 'sam@acme.com', template: 'Team invite', app: 'YT', status: 'opened' },
  { id: 'ev-2', time: '13:51', recipient: 'jo@acme.com', template: 'Team invite', app: 'YT', status: 'delivered' },
  { id: 'ev-3', time: '13:40', recipient: 'old@dead.io', template: 'Invite reminder', app: 'YT', status: 'bounced' },
  { id: 'ev-4', time: '12:18', recipient: 'lee@beta.co', template: 'Seat freed', app: 'YT', status: 'delivered' },
  { id: 'ev-5', time: '11:55', recipient: 'x@spam.net', template: 'Share notify', app: 'YT', status: 'complaint' },
  { id: 'ev-6', time: '11:30', recipient: 'mia@acme.com', template: 'Welcome', app: 'Default', status: 'opened' },
];

const MOCK_SETTINGS: EmailSettings = {
  provider: {
    name: 'Resend',
    connected: true,
    region: 'EU · Ireland',
    domain: 'send.bentech.dev',
    spf: true,
    dkim: true,
    dmarc: true,
  },
  identities: [
    { app: 'YT', from: 'notifications@send.bentech.dev', replyTo: 'support@bentech.dev' },
    { app: 'Sentinel', from: 'alerts@send.bentech.dev', replyTo: 'ops@bentech.dev' },
  ],
  notifications: [
    { key: 'team_invite', label: 'Team invites', desc: 'Sent when an admin invites a member', enabled: true },
    { key: 'invite_reminder', label: 'Invite reminders', desc: 'Nudge pending invites automatically', enabled: true },
    { key: 'seat_freed', label: 'Seat freed', desc: 'In-app + email when a seat opens up', enabled: true },
    { key: 'share_notify', label: 'Share notify', desc: 'Ping teammates when a video is shared', enabled: false },
  ],
  reminderDays: [7, 14],
};

// ---------- Getters (mock-only in Phase 1) ----------

export async function getEmailStats(): Promise<Sourced<EmailStats>> {
  return sourced(MOCK_STATS);
}

export async function getEmailTemplates(): Promise<Sourced<EmailTemplate[]>> {
  return sourced(MOCK_TEMPLATES);
}

export async function getEmailTemplate(id: string): Promise<Sourced<EmailTemplate | null>> {
  return sourced(MOCK_TEMPLATES.find((t) => t.id === id) ?? null);
}

export async function getEmailThemes(): Promise<Sourced<EmailTheme[]>> {
  return sourced(MOCK_THEMES);
}

export async function getEmailTheme(id: string): Promise<Sourced<EmailTheme | null>> {
  return sourced(MOCK_THEMES.find((t) => t.id === id) ?? null);
}

export async function getEmailActivity(): Promise<Sourced<EmailActivityEvent[]>> {
  return sourced(MOCK_ACTIVITY);
}

export async function getEmailSettings(): Promise<Sourced<EmailSettings>> {
  return sourced(MOCK_SETTINGS);
}
