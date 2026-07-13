// Customer self-service portal — tenant-scoped ticket reads.
//
// SECURITY MODEL (the whole point of this module):
//   * Every read is filtered by `tenant_ref = <session tenant>` in SQL. The
//     tenant is ALWAYS supplied by the caller from the SERVER session
//     (requirePortalSession → Clerk active org), NEVER from a client param.
//   * We ALSO route the read through withTenantRls with the caller's tenant
//     identity, so if the DB-level RLS policy is enabled (HERMES_RLS_ENABLED)
//     the app.tenant_ref GUC is set and the policy returns only that tenant's
//     rows. Explicit WHERE + RLS GUC = defence in depth; correct whether the
//     RLS flag is on or off.
//   * Field whitelist: only customer-safe columns are selected/mapped. Operator
//     fields (assignee, source, sla, impact/urgency, attrs, other-tenant
//     contact details) are NEVER read into the customer DTO.
//   * Mock-safe: a tenant-scoped read that can't reach the real table returns
//     real-EMPTY, never fabricated mock rows — a tenant with no tickets (or a DB
//     error) can never be shown another/fake tenant's data.

import { q, q1, hasDb } from '@/lib/db';
import { withTenantRls } from '@/lib/data';

// The customer-facing ticket shape. Deliberately a SUBSET of ServiceTicket —
// no assignee, source, sla, impact/urgency, attrs, or customer contact fields.
export type PortalTicket = {
  ref: string;
  subject: string;
  status: string;
  kind: string;
  priority: string;
  createdAt: string | null;
  updatedAt: string | null;
};

// Customer-safe column whitelist. If you add a column here, confirm it carries
// nothing operator-only or cross-tenant. tenant_ref is selected ONLY so the
// in-code IDOR re-check (ticketBelongsToTenant) can run — it is not exposed.
const PORTAL_COLS =
  'ref, kind, title, status, priority, opened_at, created_at, updated_at, tenant_ref';

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

// Map a raw ops.tickets row → the customer-safe DTO. Only whitelisted fields are
// copied; anything else on the row (assignee, attrs, customer_email, …) is dropped.
export function mapPortalTicket(r: any): PortalTicket {
  return {
    ref: r.ref,
    subject: r.title ?? '',
    status: r.status ?? 'open',
    kind: r.kind ?? 'request',
    priority: r.priority ?? 'medium',
    createdAt: iso(r.opened_at ?? r.created_at),
    updatedAt: iso(r.updated_at ?? r.opened_at ?? r.created_at),
  };
}

// IDOR gate. A ticket is visible to a caller ONLY when the ticket's tenant_ref
// is a non-empty string that EXACTLY equals the caller's session tenant. A blank
// / null / whitespace value on EITHER side is never a match (deny by default) —
// so an unscoped/internal ticket (tenant_ref null) is never visible to a customer,
// and a customer with no tenant can never match a ticket.
export function ticketBelongsToTenant(
  ticketTenantRef: unknown,
  sessionTenant: unknown,
): boolean {
  const a = typeof ticketTenantRef === 'string' ? ticketTenantRef.trim() : '';
  const b = typeof sessionTenant === 'string' ? sessionTenant.trim() : '';
  return a !== '' && b !== '' && a === b;
}

// All tickets owned by a tenant, newest activity first. Tenant-scoped: an empty
// tenant, or an inability to reach the DB, yields real-EMPTY (never mock).
export async function listPortalTickets(tenantRef: string): Promise<PortalTicket[]> {
  const tenant = (tenantRef ?? '').trim();
  if (!tenant) return []; // no tenant → no data (never unscoped, never mock)
  return withTenantRls(async () => {
    if (!hasDb) return []; // scoped read with no DB → real-empty, NOT mock
    try {
      const rows = await q<any>(
        `select ${PORTAL_COLS} from ops.tickets
          where tenant_ref = $1
          order by coalesce(updated_at, opened_at, created_at) desc nulls last`,
        [tenant],
      );
      return rows.map(mapPortalTicket);
    } catch {
      return []; // DB error on a scoped read → real-empty, never fabricate
    }
  }, { tenantRef: tenant, isOperator: false });
}

// A single ticket by ref, ONLY if it belongs to the caller's tenant. Returns null
// for not-found AND for a cross-tenant ref (same response — never leak existence).
// Defence in depth: filter by BOTH ref AND tenant_ref in SQL, then re-verify the
// returned row's tenant_ref in code before handing it back.
export async function getPortalTicket(
  ref: string,
  tenantRef: string,
): Promise<PortalTicket | null> {
  const tenant = (tenantRef ?? '').trim();
  const r = (ref ?? '').trim();
  if (!tenant || !r) return null;
  return withTenantRls(async () => {
    if (!hasDb) return null; // scoped detail with no DB → null (never mock)
    try {
      const row = await q1<any>(
        `select ${PORTAL_COLS} from ops.tickets where ref = $1 and tenant_ref = $2`,
        [r, tenant],
      );
      if (!row) return null;
      // Belt-and-braces IDOR re-check: never trust the row without confirming the
      // tenant match in code, independent of the WHERE clause / any RLS policy.
      if (!ticketBelongsToTenant(row.tenant_ref, tenant)) return null;
      return mapPortalTicket(row);
    } catch {
      return null;
    }
  }, { tenantRef: tenant, isOperator: false });
}
