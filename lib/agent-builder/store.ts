// Draft store for the Hermes Agent Builder.
//
// This is the persistence layer for DRAFT personas produced by the Agent Builder
// (lib/agent-builder/generate.ts). It is DELIBERATELY SEPARATE from the live
// persona registry (lib/hermes/brain/personas.ts, which is code): a row here is a
// PROPOSED persona awaiting human review, NOT an active one. Nothing in this store
// is ever loaded into the running persona set — activation is a separate, manual,
// documented code/registration step (see 22_persona_drafts.sql).
//
// Safety contract owned here:
//   * saveDraft always writes status='draft'.
//   * setStatus can flip 'draft' → 'approved'; approval records who/when but does
//     NOT make the persona live and NEVER touches lib/hermes/brain/personas.ts.
//
// Mock-safe: with no DB (hasDb === false — dev, tests) the store falls back to a
// process-local in-memory Map so the page/API still work and the CRUD logic is
// exercisable without a database. Real persistence (ops.hermes_persona_drafts)
// happens whenever DATABASE_URL is set.
import 'server-only';
import { hasDb, q, q1 } from '@/lib/db';
import type { ToolAutonomy } from '@/lib/hermes/brain/tools/types';
import type { RbacSection } from '@/lib/hermes/agent-meta';

export type DraftStatus = 'draft' | 'approved';

// The persona DEFINITION half of a draft — the same shape the live registry needs
// (id, SOUL system prompt, allowedTools, section, per-tool autonomy). Produced by
// generate.ts and edited by the admin before saving.
export type PersonaDraft = {
  id: string;
  label: string;
  systemPrompt: string;
  allowedTools: string[];
  section: RbacSection;
  autonomy: Record<string, ToolAutonomy>;
};

// A stored draft = the definition + review lifecycle metadata.
export type PersonaDraftRecord = PersonaDraft & {
  status: DraftStatus;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

// ---------------------------------------------------------------------------
// In-memory fallback (no DB). Process-local; used in dev + unit tests so the CRUD
// surface behaves identically to the DB path without a database.
// ---------------------------------------------------------------------------
const mem = new Map<string, PersonaDraftRecord>();

/** TEST-ONLY: clear the in-memory fallback between cases. No-op semantics in prod. */
export function _resetDraftStoreForTest(): void {
  mem.clear();
}

// Lazily create the table on the write path so prod doesn't hard-depend on the
// migration having run first (mirrors lib/hermes/proposals.ts).
async function ensureTable(): Promise<void> {
  await q(
    `create table if not exists ops.hermes_persona_drafts (
       id            text primary key,
       label         text not null,
       system_prompt text not null,
       allowed_tools text[] default '{}',
       section       text,
       autonomy      jsonb default '{}'::jsonb,
       status        text default 'draft',
       created_by    text,
       created_at    timestamptz default now(),
       approved_by   text,
       approved_at   timestamptz
     )`,
  );
}

function mapRow(r: any): PersonaDraftRecord {
  const autonomy =
    typeof r.autonomy === 'string'
      ? (safeParse(r.autonomy) as Record<string, ToolAutonomy>)
      : ((r.autonomy ?? {}) as Record<string, ToolAutonomy>);
  return {
    id: String(r.id),
    label: r.label ?? '',
    systemPrompt: r.system_prompt ?? '',
    allowedTools: Array.isArray(r.allowed_tools) ? r.allowed_tools.map(String) : [],
    section: (r.section ?? 'operations') as RbacSection,
    autonomy,
    status: (r.status ?? 'draft') as DraftStatus,
    createdBy: r.created_by ?? null,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
    approvedBy: r.approved_by ?? null,
    approvedAt:
      r.approved_at == null
        ? null
        : r.approved_at instanceof Date
          ? r.approved_at.toISOString()
          : String(r.approved_at),
  };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Persist (upsert by id) a persona DRAFT. Always writes status='draft' — this is
 * the ONLY status a save can produce; going live is never a save. Returns the
 * stored record.
 */
export async function saveDraft(
  def: PersonaDraft,
  createdBy: string | null,
): Promise<PersonaDraftRecord> {
  const record: PersonaDraftRecord = {
    ...def,
    allowedTools: [...def.allowedTools],
    autonomy: { ...def.autonomy },
    status: 'draft',
    createdBy: createdBy ?? null,
    createdAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
  };

  if (!hasDb) {
    // Preserve the original createdAt on re-save of the same id (idempotent draft).
    const prior = mem.get(def.id);
    if (prior) record.createdAt = prior.createdAt;
    mem.set(def.id, record);
    return record;
  }

  await ensureTable();
  const row = await q1<any>(
    `insert into ops.hermes_persona_drafts
       (id, label, system_prompt, allowed_tools, section, autonomy, status, created_by)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'draft', $7)
     on conflict (id) do update set
       label = excluded.label,
       system_prompt = excluded.system_prompt,
       allowed_tools = excluded.allowed_tools,
       section = excluded.section,
       autonomy = excluded.autonomy
     returning id, label, system_prompt, allowed_tools, section, autonomy, status,
               created_by, created_at, approved_by, approved_at`,
    [
      def.id,
      def.label,
      def.systemPrompt,
      def.allowedTools,
      def.section,
      JSON.stringify(def.autonomy ?? {}),
      createdBy ?? null,
    ],
  );
  return row ? mapRow(row) : record;
}

/** List drafts, newest first. Empty array with no DB (empty mem) or on error. */
export async function listDrafts(): Promise<PersonaDraftRecord[]> {
  if (!hasDb) {
    return [...mem.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  try {
    await ensureTable();
    const rows = await q<any>(
      `select id, label, system_prompt, allowed_tools, section, autonomy, status,
              created_by, created_at, approved_by, approved_at
         from ops.hermes_persona_drafts
        order by created_at desc
        limit 200`,
    );
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

/** Fetch one draft by id. Null if not found / no DB row / on error. */
export async function getDraft(id: string): Promise<PersonaDraftRecord | null> {
  if (!hasDb) return mem.get(id) ?? null;
  try {
    await ensureTable();
    const row = await q1<any>(
      `select id, label, system_prompt, allowed_tools, section, autonomy, status,
              created_by, created_at, approved_by, approved_at
         from ops.hermes_persona_drafts
        where id = $1`,
      [id],
    );
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

/**
 * Transition a draft's status. Approving records approved_by/approved_at.
 *
 * IMPORTANT: this only flips a row's lifecycle flag. It does NOT register the
 * persona into the live registry and can NEVER make it executable — activation is
 * a separate, deliberate, manual code step. Returns the updated record, or null if
 * the draft doesn't exist.
 */
export async function setStatus(
  id: string,
  status: DraftStatus,
  by: string | null,
): Promise<PersonaDraftRecord | null> {
  const approving = status === 'approved';

  if (!hasDb) {
    const rec = mem.get(id);
    if (!rec) return null;
    const updated: PersonaDraftRecord = {
      ...rec,
      status,
      approvedBy: approving ? (by ?? null) : null,
      approvedAt: approving ? new Date().toISOString() : null,
    };
    mem.set(id, updated);
    return updated;
  }

  try {
    await ensureTable();
    const row = await q1<any>(
      `update ops.hermes_persona_drafts
          set status = $2,
              approved_by = case when $2 = 'approved' then $3 else null end,
              approved_at = case when $2 = 'approved' then now() else null end
        where id = $1
      returning id, label, system_prompt, allowed_tools, section, autonomy, status,
                created_by, created_at, approved_by, approved_at`,
      [id, status, by ?? null],
    );
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}
