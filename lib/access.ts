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
import { createTicket, getServiceTicket } from './data';
import {
  ESTATE_APPS, getApp, isOpsOwned, isValidAppRole,
  type AccessLevel, type AppRole,
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
  // Per-app role (Sentinel uses this). app id -> role, absent if none set.
  roles: Record<string, AppRole>;
  // Per-app read-through entitlements (YT tier/quota). app id -> entitlement.
  entitlements: Record<string, Entitlement>;
};

// Read-through DISPLAY of an app-owned entitlement (e.g. YT tier/quota). Sentinel
// never authors these; `synced` is false until a pull populates app_entitlements.
export type Entitlement = {
  app: string;
  tier: string | null;
  quotaLimit: number | null;
  quotaUsed: number | null;
  quotaPeriod: string | null;
  addons: Record<string, any>;
  externalRef: string | null;
  syncedAt: string | null;
  synced: boolean;
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
function mockEnt(app: string, tier: string, used: number, limit: number): Entitlement {
  return {
    app, tier, quotaUsed: used, quotaLimit: limit, quotaPeriod: 'month',
    addons: {}, externalRef: null, syncedAt: new Date(Date.now() - 3600000).toISOString(), synced: true,
  };
}

const MOCK_USERS: UserSummary[] = [
  {
    id: 'user_mock_admin', name: 'Ben Percival', email: 'bpercival92@gmail.com',
    createdAt: Date.now() - 120 * 86400000, lastActiveAt: Date.now() - 3600000,
    access: { yt: 'admin', sentinel: 'admin', bruce: 'admin' },
    roles: { sentinel: 'admin' },
    entitlements: { yt: mockEnt('yt', 'Enterprise', 412, 5000) },
  },
  {
    id: 'user_mock_2', name: 'Alex Kowalski', email: 'a.kowalski@example.com',
    createdAt: Date.now() - 40 * 86400000, lastActiveAt: Date.now() - 2 * 86400000,
    access: { yt: 'admin', bruce: 'viewer' },
    roles: {},
    entitlements: { yt: mockEnt('yt', 'Pro', 47, 100) },
  },
  {
    id: 'user_mock_3', name: 'Rosa Silva', email: 'rosa.s@example.com',
    createdAt: Date.now() - 9 * 86400000, lastActiveAt: Date.now() - 5 * 3600000,
    access: { yt: 'viewer' },
    roles: {},
    entitlements: {},
  },
  {
    id: 'user_mock_4', name: 'T. Nakamura', email: 'tn.builds@example.com',
    createdAt: Date.now() - 2 * 86400000, lastActiveAt: Date.now() - 30 * 60000,
    access: {},
    roles: {},
    entitlements: {},
  },
];

function emptyAccess(): Record<string, AccessLevel> {
  return Object.fromEntries(ESTATE_APPS.map((a) => [a.id, 'none' as AccessLevel]));
}

// ---------- DB: per-user access grants -----------------------------------
type AccessRow = { clerk_user_id: string; app: string; access_level: string; app_role: string | null };
type AccessMaps = {
  levels: Map<string, Record<string, AccessLevel>>;
  roles: Map<string, Record<string, AppRole>>;
};

// Pulls both the coarse access_level and the per-app app_role. app_role is read
// with a degrade-gracefully guard: if the column doesn't exist yet (migration 07
// not applied), the select throws and we fall back to levels-only.
async function fetchAccessMap(clerkUserIds: string[]): Promise<AccessMaps> {
  const levels = new Map<string, Record<string, AccessLevel>>();
  const roles = new Map<string, Record<string, AppRole>>();
  if (!hasDb || clerkUserIds.length === 0) return { levels, roles };

  const apply = (rows: AccessRow[]) => {
    for (const r of rows) {
      const lm = levels.get(r.clerk_user_id) ?? {};
      lm[r.app] = (r.access_level ?? 'none') as AccessLevel;
      levels.set(r.clerk_user_id, lm);
      if (r.app_role && isValidAppRole(r.app_role)) {
        const rm = roles.get(r.clerk_user_id) ?? {};
        rm[r.app] = r.app_role as AppRole;
        roles.set(r.clerk_user_id, rm);
      }
    }
  };

  try {
    apply(await q<AccessRow>(
      'select clerk_user_id, app, access_level, app_role from ops.user_app_access where clerk_user_id = any($1)',
      [clerkUserIds]
    ));
  } catch {
    // app_role column missing → degrade to levels-only.
    try {
      const rows = await q<AccessRow>(
        'select clerk_user_id, app, access_level, null::text as app_role from ops.user_app_access where clerk_user_id = any($1)',
        [clerkUserIds]
      );
      apply(rows);
    } catch {
      /* fall through — caller treats missing as 'none' */
    }
  }
  return { levels, roles };
}

// ---------- DB: read-through entitlements cache (YT tier/quota) -----------
function mapEntitlement(r: any): Entitlement {
  const addons = (typeof r.addons === 'string' ? safeJsonObj(r.addons) : r.addons) ?? {};
  const syncedAt = r.synced_at
    ? (r.synced_at instanceof Date ? r.synced_at.toISOString() : r.synced_at)
    : null;
  return {
    app: r.app,
    tier: r.tier ?? null,
    quotaLimit: r.quota_limit == null ? null : Number(r.quota_limit),
    quotaUsed: r.quota_used == null ? null : Number(r.quota_used),
    quotaPeriod: r.quota_period ?? null,
    addons,
    externalRef: r.external_ref ?? null,
    syncedAt,
    synced: Boolean(syncedAt),
  };
}

function safeJsonObj(s: string): Record<string, any> {
  try { return JSON.parse(s); } catch { return {}; }
}

async function fetchEntitlementsMap(clerkUserIds: string[]): Promise<Map<string, Record<string, Entitlement>>> {
  const byUser = new Map<string, Record<string, Entitlement>>();
  if (!hasDb || clerkUserIds.length === 0) return byUser;
  try {
    const rows = await q<any>(
      'select clerk_user_id, app, tier, quota_limit, quota_used, quota_period, addons, external_ref, synced_at from ops.app_entitlements where clerk_user_id = any($1)',
      [clerkUserIds]
    );
    for (const r of rows) {
      const m = byUser.get(r.clerk_user_id) ?? {};
      m[r.app] = mapEntitlement(r);
      byUser.set(r.clerk_user_id, m);
    }
  } catch {
    // ops.app_entitlements missing (migration 07 not applied) → no entitlements,
    // UI renders the "not synced yet" state.
  }
  return byUser;
}

// getEntitlements — one user's read-through entitlements (e.g. YT tier/quota).
//
// TODO(Phase 2 — YT pull): the actual sync from YT's DB needs a read grant /
// endpoint that is NOT yet provisioned. For now this only reads the
// ops.app_entitlements CACHE; rows are absent until that sync lands, so callers
// get `synced: false` and the UI shows "not synced yet". When the YT read is
// provisioned, add a pull that upserts ops.app_entitlements here (on-demand).
export async function getEntitlements(clerkUserId: string): Promise<Record<string, Entitlement>> {
  const m = await fetchEntitlementsMap([clerkUserId]);
  return m.get(clerkUserId) ?? {};
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
        roles: {},
        entitlements: {},
      };
    });
    live = true;
  } catch (e: any) {
    return { rows: MOCK_USERS, live: false, note: e?.message ?? 'Clerk unavailable' };
  }

  // Join DB access (source of truth) over the Clerk-metadata seed.
  const ids = users.map((u) => u.id);
  const { levels, roles } = await fetchAccessMap(ids);
  if (levels.size > 0) {
    for (const u of users) {
      const m = levels.get(u.id);
      if (m) u.access = { ...emptyAccess(), ...m };
    }
  }
  if (roles.size > 0) {
    for (const u of users) u.roles = roles.get(u.id) ?? {};
  }
  // Read-through entitlements (YT tier/quota) — display only.
  const ents = await fetchEntitlementsMap(ids);
  if (ents.size > 0) {
    for (const u of users) u.entitlements = ents.get(u.id) ?? {};
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
      roles: {}, entitlements: {},
    };
    live = true;
  } catch (e: any) {
    user = MOCK_USERS.find((m) => m.id === clerkUserId) ?? null;
    note = e?.message ?? 'Clerk unavailable';
    if (user) user = { ...user, access: { ...emptyAccess(), ...user.access } };
  }

  if (!user) return { user: null, audit: [], live, note };

  // DB access (source of truth) overrides the Clerk seed.
  const { levels, roles } = await fetchAccessMap([user.id]);
  const m = levels.get(user.id);
  if (m) user.access = { ...emptyAccess(), ...m };
  const rm = roles.get(user.id);
  if (rm) user.roles = rm;
  // Read-through entitlements (YT tier/quota) — display only. Falls back to the
  // mock entitlements when Clerk failed (live=false) and we matched a mock user.
  if (live || !user.entitlements || Object.keys(user.entitlements).length === 0) {
    const ents = await fetchEntitlementsMap([user.id]);
    const e = ents.get(user.id);
    if (e) user.entitlements = e;
  }

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
  actor: string,
  appRole?: AppRole | null
): Promise<SetAccessResult> {
  const def = getApp(app);
  if (!def) throw new Error(`unknown app: ${app}`);
  if (!hasDb) throw new Error('no DB — cannot persist access change');

  // PER-APP SOURCE OF TRUTH: Sentinel only writes apps it owns (Sentinel, Bruce).
  // YT tier/credits are owned by YT's DB and are display + request-only in
  // Phase 1 — reject direct writes here (YT writes land via the YT admin API in
  // Phase 2). Use requestQuotaIncrease / grantOnApproval for YT instead.
  if (!isOpsOwned(app)) {
    throw new Error(`${def.name} access is owned by ${def.source.toUpperCase()} — use request flow, not a direct write`);
  }
  if (appRole != null && !isValidAppRole(appRole)) {
    throw new Error(`invalid app role: ${appRole}`);
  }

  // 1. Read previous level/role for the audit old_value.
  const prev = await q1<{ access_level: string; app_role: string | null }>(
    'select access_level, app_role from ops.user_app_access where clerk_user_id=$1 and app=$2',
    [clerkUserId, app]
  ).catch(async () => {
    const r = await q1<{ access_level: string }>(
      'select access_level from ops.user_app_access where clerk_user_id=$1 and app=$2',
      [clerkUserId, app]
    );
    return r ? { access_level: r.access_level, app_role: null } : null;
  });
  const oldValue = prev?.access_level ?? 'none';

  // 2. Upsert the grant (source of truth), including app_role + source. If the
  //    app_role/source columns don't exist yet (migration 07 not applied), fall
  //    back to the legacy level-only upsert so the existing flow never regresses.
  try {
    await q(
      `insert into ops.user_app_access (clerk_user_id, app, access_level, app_role, source, granted_by)
         values ($1, $2, $3, $4, $5, $6)
       on conflict (clerk_user_id, app)
         do update set access_level = excluded.access_level,
                       app_role     = excluded.app_role,
                       source       = excluded.source,
                       granted_by   = excluded.granted_by,
                       updated_at   = now()`,
      [clerkUserId, app, level, appRole ?? null, def.source, actor]
    );
  } catch {
    await q(
      `insert into ops.user_app_access (clerk_user_id, app, access_level, granted_by)
         values ($1, $2, $3, $4)
       on conflict (clerk_user_id, app)
         do update set access_level = excluded.access_level,
                       granted_by   = excluded.granted_by,
                       updated_at   = now()`,
      [clerkUserId, app, level, actor]
    );
  }

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

  // 5. Audit (append-only). Encode the role alongside the level when set so the
  //    trail captures the per-app role change too.
  const newValue = appRole ? `${level} (role: ${appRole})` : level;
  try {
    await q(
      `insert into ops.access_audit (clerk_user_id, app, action, old_value, new_value, actor)
         values ($1, $2, 'set_access', $3, $4, $5)`,
      [clerkUserId, app, oldValue, newValue, actor]
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

// ---------- Orgs (read-only): mirror of Clerk Organizations ---------------
export type OrgMember = { userId: string; label: string; role: string };
export type OrgSummary = {
  id: string;
  name: string;
  membersCount: number;
  members: OrgMember[];
};

const MOCK_ORGS: OrgSummary[] = [
  {
    id: 'org_mock_1', name: 'Bentech (Estate)', membersCount: 2,
    members: [
      { userId: 'user_mock_admin', label: 'bpercival92@gmail.com', role: 'admin' },
      { userId: 'user_mock_2', label: 'a.kowalski@example.com', role: 'basic_member' },
    ],
  },
];

// Lists Clerk Organizations + their members for the read-only Orgs view. Uses
// clerkClient like listUsers; degrades to a mock/empty state if Clerk is
// unavailable or there are no orgs. READ-ONLY in Phase 1 (ops.orgs/org_members
// are a mirror written by a future reconcile, not by this view).
export async function listOrgs(limit = 50): Promise<Sourced<OrgSummary>> {
  try {
    const client = await clerkClient();
    const res = await client.organizations.getOrganizationList({ limit });
    const data: any[] = res?.data ?? [];
    if (data.length === 0) return { rows: [], live: true, note: 'no organizations' };

    const rows: OrgSummary[] = [];
    for (const o of data) {
      let members: OrgMember[] = [];
      try {
        const mres = await client.organizations.getOrganizationMembershipList({ organizationId: o.id, limit: 100 });
        const mdata: any[] = mres?.data ?? [];
        members = mdata.map((m: any) => {
          const pud = m.publicUserData ?? {};
          const label = pud.identifier
            ?? [pud.firstName, pud.lastName].filter(Boolean).join(' ')
            ?? pud.userId ?? '—';
          return { userId: pud.userId ?? m.id, label, role: m.role ?? 'basic_member' };
        });
      } catch {
        /* membership fetch failed — show the org with no members */
      }
      rows.push({
        id: o.id,
        name: o.name ?? o.slug ?? o.id,
        membersCount: o.membersCount ?? members.length,
        members,
      });
    }
    return { rows, live: true };
  } catch (e: any) {
    return { rows: MOCK_ORGS, live: false, note: e?.message ?? 'Clerk unavailable' };
  }
}

// ---------- grantOnApproval: human-approved request → apply (or record) ----
// Called from the request-ticket "Apply grant" action (global_admin). It reads
// the request ticket by ref and acts per the app's source-of-truth ownership:
//   * Sentinel/Bruce (ops-owned) → APPLY the grant via setUserAccess and audit
//     action='quota_grant' with the ticket ref.
//   * YT (yt-owned)              → DO NOT write (YT owns tier/credits). Record
//     intent + audit only; a human applies the change in YT (Phase 2: YT admin
//     API). Returns applied=false so the UI can say "recorded, apply in YT".
//
// The request ticket carries the target in attrs (set by requestQuotaIncrease):
//   attrs.target_user, attrs.requested_limit. For ops-owned grant-of-access
//   requests, attrs.grant_app / attrs.grant_level / attrs.grant_role may carry
//   the desired access; absent → defaults to granting 'viewer'.
export type GrantOnApprovalResult = {
  ok: boolean;
  applied: boolean;     // true if Sentinel wrote the grant; false if record-only (YT)
  app: string | null;
  ref: string;
  note?: string;
};

export async function grantOnApproval(ticketRef: string, actor: string): Promise<GrantOnApprovalResult> {
  if (!hasDb) throw new Error('no DB — cannot apply grant');

  const { row } = await getServiceTicket(ticketRef);
  if (!row) throw new Error(`request ticket not found: ${ticketRef}`);
  if (row.kind !== 'request') throw new Error(`${ticketRef} is not a request ticket`);

  const attrs = row.attrs ?? {};
  const targetUser: string | undefined = attrs.target_user;
  if (!targetUser) throw new Error(`${ticketRef} has no target_user in attrs`);

  // Resolve which app the grant is for: explicit attrs.grant_app, else map from
  // the ticket's app label (YT|Sentinel|Bruce) back to a registry id.
  const appFromLabel = ESTATE_APPS.find((a) => a.ticketApp === row.app)?.id;
  const app: string | undefined = attrs.grant_app ?? appFromLabel;
  const def = app ? getApp(app) : undefined;
  if (!def) throw new Error(`${ticketRef}: could not resolve a target app`);

  // YT (and any non-ops-owned app): record intent + audit, do NOT write.
  if (!isOpsOwned(def.id)) {
    try {
      await q(
        `insert into ops.access_audit (clerk_user_id, app, action, new_value, actor, ref)
           values ($1, $2, 'quota_grant', $3, $4, $5)`,
        [targetUser, def.id, attrs.requested_limit ?? 'approved', actor, ticketRef]
      );
    } catch { /* best-effort */ }
    return {
      ok: true, applied: false, app: def.id, ref: ticketRef,
      note: `${def.name} is owned by ${def.source.toUpperCase()} — grant recorded; apply the change in ${def.name} (YT admin API, Phase 2).`,
    };
  }

  // Ops-owned (Sentinel/Bruce): apply the grant via setUserAccess.
  const level = (attrs.grant_level && (attrs.grant_level === 'admin' || attrs.grant_level === 'viewer'))
    ? (attrs.grant_level as AccessLevel) : ('viewer' as AccessLevel);
  const role: AppRole | null = (def.accessControl === 'role' && attrs.grant_role && isValidAppRole(attrs.grant_role))
    ? (attrs.grant_role as AppRole) : null;

  await setUserAccess(targetUser, def.id, level, actor, role);

  // Audit the grant explicitly with the ticket ref (setUserAccess logs set_access;
  // this adds the approval linkage).
  try {
    await q(
      `insert into ops.access_audit (clerk_user_id, app, action, new_value, actor, ref)
         values ($1, $2, 'quota_grant', $3, $4, $5)`,
      [targetUser, def.id, role ? `${level} (role: ${role})` : level, actor, ticketRef]
    );
  } catch { /* best-effort */ }

  return { ok: true, applied: true, app: def.id, ref: ticketRef };
}
