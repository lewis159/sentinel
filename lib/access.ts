// User & App Access Management — server-only data layer (RESEARCH.md, Hybrid /
// Approach D). The Sentinel `ops` DB is the SOURCE OF TRUTH; Clerk
// `publicMetadata.apps` is a mirror/cache the estate apps read from their
// session token; `ops.access_audit` is the append-only trail.
//
// Write path for an access change (setUserAccess):
//   1. upsert ops.user_app_access  (truth)
//   2. rebuild the whole apps map from the DB and mirror into Clerk
//      publicMetadata.apps via clerkClient().users.updateUserMetadata
//   3. insert ops.access_audit row (old → new, actor)
//
// Every read is DB-first with a mock fallback (matching lib/data.ts) so the UI
// renders without a DB; the page surfaces a LIVE/mock badge accordingly.
//
// NOTE: no live Clerk Backend-API writes happen during the build/typecheck —
// they only run at request time when CLERK_SECRET_KEY + DB are wired.

import { clerkClient } from '@clerk/nextjs/server';
import { hasDb, q, q1 } from './db';
import { createTicket } from './data';
import {
  ESTATE_APPS, getApp, type AccessLevel,
} from './apps';

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  imageUrl?: string;
  createdAt: number | null;
  lastActiveAt: number | null;
  // Per-app access map, app id -> level. 'none' for apps with no row.
  access: Record<string, AccessLevel>;
};

export type AccessAuditEntry = {
  id: number;
  app: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
  ref: string | null;
  createdAt: string;
};

export type Sourced<T> = { rows: T[]; live: boolean; note?: string };

// ---------- Mock users (renders the screen without Clerk/DB) -------------
const MOCK_USERS: UserSummary[] = [
  {
    id: 'user_mock_admin', name: 'Ben Percival', email: 'bpercival92@gmail.com',
    createdAt: Date.now() - 120 * 86400000, lastActiveAt: Date.now() - 3600000,
    access: { yt: 'admin', sentinel: 'admin', bruce: 'admin' },
  },
  {
    id: 'user_mock_2', name: 'Alex Kowalski', email: 'a.kowalski@example.com',
    createdAt: Date.now() - 40 * 86400000, lastActiveAt: Date.now() - 2 * 86400000,
    access: { yt: 'admin', bruce: 'viewer' },
  },
  {
    id: 'user_mock_3', name: 'Rosa Silva', email: 'rosa.s@example.com',
    createdAt: Date.now() - 9 * 86400000, lastActiveAt: Date.now() - 5 * 3600000,
    access: { yt: 'viewer' },
  },
  {
    id: 'user_mock_4', name: 'T. Nakamura', email: 'tn.builds@example.com',
    createdAt: Date.now() - 2 * 86400000, lastActiveAt: Date.now() - 30 * 60000,
    access: {},
  },
];

function emptyAccess(): Record<string, AccessLevel> {
  return Object.fromEntries(ESTATE_APPS.map((a) => [a.id, 'none' as AccessLevel]));
}

// ---------- DB: per-user access grants -----------------------------------
type AccessRow = { clerk_user_id: string; app: string; access_level: string };

async function fetchAccessMap(clerkUserIds: string[]): Promise<Map<string, Record<string, AccessLevel>>> {
  const byUser = new Map<string, Record<string, AccessLevel>>();
  if (!hasDb || clerkUserIds.length === 0) return byUser;
  try {
    const rows = await q<AccessRow>(
      'select clerk_user_id, app, access_level from ops.user_app_access where clerk_user_id = any($1)',
      [clerkUserIds]
    );
    for (const r of rows) {
      const m = byUser.get(r.clerk_user_id) ?? {};
      m[r.app] = (r.access_level ?? 'none') as AccessLevel;
      byUser.set(r.clerk_user_id, m);
    }
  } catch {
    /* fall through — caller treats missing as 'none' */
  }
  return byUser;
}

// ---------- listUsers: Clerk Backend API + DB access join ----------------
export async function listUsers(limit = 100, offset = 0): Promise<Sourced<UserSummary>> {
  let users: UserSummary[];
  let live = false;
  let note: string | undefined;

  try {
    const client = await clerkClient();
    const res = await client.users.getUserList({ limit, offset, orderBy: '-created_at' });
    const data = res?.data ?? [];
    if (data.length === 0) {
      return { rows: MOCK_USERS, live: false, note: 'no Clerk users' };
    }
    users = data.map((u: any) => {
      const email =
        u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses?.[0]?.emailAddress ??
        '';
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || email.split('@')[0] || 'user';
      const metaApps = ((u.publicMetadata as any)?.apps ?? {}) as Record<string, AccessLevel>;
      return {
        id: u.id,
        name,
        email,
        imageUrl: u.imageUrl,
        createdAt: u.createdAt ?? null,
        lastActiveAt: u.lastActiveAt ?? null,
        // Seed from Clerk metadata; DB join below overrides as the source of truth.
        access: { ...emptyAccess(), ...metaApps },
      };
    });
    live = true;
  } catch (e: any) {
    return { rows: MOCK_USERS, live: false, note: e?.message ?? 'Clerk unavailable' };
  }

  // Join DB access (source of truth) over the Clerk-metadata seed.
  const dbMap = await fetchAccessMap(users.map((u) => u.id));
  if (dbMap.size > 0) {
    for (const u of users) {
      const m = dbMap.get(u.id);
      if (m) u.access = { ...emptyAccess(), ...m };
    }
  }

  return { rows: users, live, note };
}

// ---------- getUserAccess: one user, full per-app map --------------------
export async function getUserAccess(clerkUserId: string): Promise<{
  user: UserSummary | null;
  audit: AccessAuditEntry[];
  live: boolean;
  note?: string;
}> {
  // Try Clerk for the user identity; fall back to a mock match.
  let user: UserSummary | null = null;
  let live = false;
  let note: string | undefined;

  try {
    const client = await clerkClient();
    const u: any = await client.users.getUser(clerkUserId);
    const email =
      u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      '';
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || email.split('@')[0] || 'user';
    const metaApps = ((u.publicMetadata as any)?.apps ?? {}) as Record<string, AccessLevel>;
    user = {
      id: u.id, name, email, imageUrl: u.imageUrl,
      createdAt: u.createdAt ?? null, lastActiveAt: u.lastActiveAt ?? null,
      access: { ...emptyAccess(), ...metaApps },
    };
    live = true;
  } catch (e: any) {
    user = MOCK_USERS.find((m) => m.id === clerkUserId) ?? null;
    note = e?.message ?? 'Clerk unavailable';
    if (user) user = { ...user, access: { ...emptyAccess(), ...user.access } };
  }

  if (!user) return { user: null, audit: [], live, note };

  // DB access (source of truth) overrides the Clerk seed.
  const dbMap = await fetchAccessMap([user.id]);
  const m = dbMap.get(user.id);
  if (m) user.access = { ...emptyAccess(), ...m };

  const audit = await getUserAudit(user.id);
  return { user, audit: audit.rows, live, note };
}

// ---------- audit feed for a user ----------------------------------------
export async function getUserAudit(clerkUserId: string, limit = 50): Promise<Sourced<AccessAuditEntry>> {
  if (!hasDb) return { rows: [], live: false, note: 'no DB' };
  try {
    const rows = await q<any>(
      'select id, app, action, old_value, new_value, actor, ref, created_at from ops.access_audit where clerk_user_id=$1 order by created_at desc limit $2',
      [clerkUserId, limit]
    );
    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        app: r.app ?? '—',
        action: r.action ?? 'set_access',
        oldValue: r.old_value ?? null,
        newValue: r.new_value ?? null,
        actor: r.actor ?? null,
        ref: r.ref ?? null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
      live: true,
    };
  } catch (e: any) {
    return { rows: [], live: false, note: e?.message ?? 'error' };
  }
}

// ---------- setUserAccess: DB upsert → Clerk mirror → audit --------------
export type SetAccessResult = {
  ok: boolean;
  apps: Record<string, AccessLevel>;
  mirrored: boolean; // true if the Clerk publicMetadata mirror succeeded
  note?: string;
};

export async function setUserAccess(
  clerkUserId: string,
  app: string,
  level: AccessLevel,
  actor: string
): Promise<SetAccessResult> {
  if (!getApp(app)) throw new Error(`unknown app: ${app}`);
  if (!hasDb) throw new Error('no DB — cannot persist access change');

  // 1. Read previous level for the audit old_value.
  const prev = await q1<{ access_level: string }>(
    'select access_level from ops.user_app_access where clerk_user_id=$1 and app=$2',
    [clerkUserId, app]
  );
  const oldValue = prev?.access_level ?? 'none';

  // 2. Upsert the grant (source of truth).
  await q(
    `insert into ops.user_app_access (clerk_user_id, app, access_level, granted_by)
       values ($1, $2, $3, $4)
     on conflict (clerk_user_id, app)
       do update set access_level = excluded.access_level,
                     granted_by   = excluded.granted_by,
                     updated_at   = now()`,
    [clerkUserId, app, level, actor]
  );

  // 3. Rebuild the WHOLE apps map from the DB (truth) — updateUserMetadata only
  //    shallow-merges, so we always write the complete object. Omit 'none'.
  const rows = await q<{ app: string; access_level: string }>(
    'select app, access_level from ops.user_app_access where clerk_user_id=$1',
    [clerkUserId]
  );
  const apps: Record<string, AccessLevel> = {};
  for (const r of rows) {
    if (r.access_level && r.access_level !== 'none') apps[r.app] = r.access_level as AccessLevel;
  }

  // 4. Mirror into Clerk publicMetadata.apps (delivery/cache). If this fails the
  //    DB remains correct; a reconcile pass re-pushes (RESEARCH §5.4).
  let mirrored = false;
  let note: string | undefined;
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(clerkUserId, { publicMetadata: { apps } });
    mirrored = true;
  } catch (e: any) {
    note = `mirror failed: ${e?.message ?? 'error'}`;
  }

  // 5. Audit (append-only).
  try {
    await q(
      `insert into ops.access_audit (clerk_user_id, app, action, old_value, new_value, actor)
         values ($1, $2, 'set_access', $3, $4, $5)`,
      [clerkUserId, app, oldValue, level, actor]
    );
  } catch {
    /* audit best-effort — never block the grant on an audit insert */
  }

  return { ok: true, apps, mirrored, note };
}

// ---------- requestQuotaIncrease: metered apps → service-request ticket ---
export type QuotaRequestInput = {
  clerkUserId: string;
  targetUserLabel: string; // email/name of the user the request is for
  app: string;
  currentLimit?: string;
  requestedLimit: string;
  reason: string;
  actor: string;
};

export async function requestQuotaIncrease(input: QuotaRequestInput): Promise<{ ref: string }> {
  const def = getApp(input.app);
  if (!def) throw new Error(`unknown app: ${input.app}`);
  if (!def.metered) throw new Error(`${def.name} is not a metered app`);
  if (!hasDb) throw new Error('no DB — cannot create ticket');

  const { ref } = await createTicket({
    kind: 'request',
    title: `Limit increase — ${def.name} for ${input.targetUserLabel}`,
    description:
      `Request to increase the ${def.metricLabel ?? 'usage limit'} for ${input.targetUserLabel}.\n` +
      `Current: ${input.currentLimit || '—'} → Requested: ${input.requestedLimit}\n\n` +
      `Reason: ${input.reason}`,
    app: def.ticketApp,
    impact: 'low',
    urgency: 'medium',
    source: 'access-mgmt',
    attrs: {
      current_limit: input.currentLimit || null,
      requested_limit: input.requestedLimit,
      reason: input.reason,
      target_user: input.clerkUserId,
      target_user_label: input.targetUserLabel,
      metric: def.metricLabel ?? null,
    },
  });

  // Link the ticket ref back to the user via the audit trail (RESEARCH: store
  // the ticket ref on the access row or audit). Best-effort.
  try {
    await q(
      `insert into ops.access_audit (clerk_user_id, app, action, new_value, actor, ref)
         values ($1, $2, 'quota_request', $3, $4, $5)`,
      [input.clerkUserId, input.app, input.requestedLimit, input.actor, ref]
    );
    // Also stamp the most recent access row with the ticket ref for quick lookup.
    await q(
      'update ops.user_app_access set ref=$3, updated_at=now() where clerk_user_id=$1 and app=$2',
      [input.clerkUserId, input.app, ref]
    );
  } catch {
    /* best-effort link */
  }

  return { ref };
}
