'use client';

import { useState } from 'react';
import {
  ROLE_PRESETS,
  PRESET_LABELS,
  resolveSections,
  type Section,
} from '@/lib/v2/rbac';

// The full dot order shown per row. 'overview' is always-on (locked); the other
// five are gateable toggles.
const SECTION_ORDER: Section[] = [
  'overview',
  'support',
  'operations',
  'security',
  'admin',
  'hermes',
];
const GATEABLE: Section[] = ['support', 'operations', 'security', 'admin', 'hermes'];

const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  support: 'Support',
  operations: 'Operations',
  security: 'Security',
  admin: 'Admin',
  hermes: 'Hermes',
};

const ROLE_KEYS = Object.keys(ROLE_PRESETS);

type UserRow = {
  id: string;
  name: string;
  email: string;
  role?: string;
  sections?: string[];
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Per-row editable state: the currently selected role, and the current
// override (null → no override, effective set falls back to the role preset).
type RowState = {
  role?: string;
  override: string[] | null;
  save: SaveState;
  error?: string;
};

function initials(name: string, email: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function grantsLabel(effective: Section[]): string {
  if (effective.length >= SECTION_ORDER.length) return 'all';
  // Show the gateable ones granted (overview is implicit / always-on).
  const shown = effective.filter((s) => s !== 'overview');
  return shown.length ? shown.map((s) => SECTION_LABELS[s]).join(' · ') : 'overview only';
}

export default function AccessEditor({ users }: { users: UserRow[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const u of users) {
      init[u.id] = {
        role: u.role,
        override: Array.isArray(u.sections) ? [...u.sections] : null,
        save: 'idle',
      };
    }
    return init;
  });

  function update(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function onRoleChange(id: string, role: string) {
    // Changing role clears the override so the new preset takes effect cleanly.
    update(id, { role, override: null, save: 'idle' });
  }

  function onToggle(id: string, section: Section, role: string | undefined, override: string[] | null) {
    if (role === 'global_admin') return; // locked — all on
    // Start the override from the CURRENT effective set, then toggle `section`.
    const effective = resolveSections(role, override).filter((s) => s !== 'overview');
    const set = new Set<string>(effective);
    if (set.has(section)) set.delete(section);
    else set.add(section);
    update(id, { override: Array.from(set), save: 'idle' });
  }

  async function onSave(id: string, role: string | undefined, override: string[] | null) {
    update(id, { save: 'saving', error: undefined });
    try {
      const res = await fetch('/api/v2/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, role, sections: override }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && data?.ok) {
        update(id, { save: 'saved' });
      } else {
        update(id, { save: 'error', error: data?.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      update(id, { save: 'error', error: e instanceof Error ? e.message : 'Network error' });
    }
  }

  if (!users.length) {
    return (
      <div className="v2-card" style={{ padding: 24 }}>
        <div className="v2-adm-empty">
          No staff loaded. Clerk may be unreachable or no users exist yet.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="v2-card" style={{ overflow: 'hidden' }}>
        <table className="v2-table">
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Role</th>
              <th>Sections granted</th>
              <th style={{ textAlign: 'right' }}>Save</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const row = rows[u.id];
              const role = row.role;
              const override = row.override;
              const isGlobal = role === 'global_admin';
              const effective = resolveSections(role, override);

              return (
                <tr key={u.id}>
                  <td>
                    <div className="v2-adm-staff">
                      <span className={`v2-adm-av${isGlobal ? ' accent' : ''}`}>
                        {initials(u.name, u.email)}
                      </span>
                      <div>
                        <div className="v2-adm-name">{u.name}</div>
                        <div className="v2-adm-email">{u.email}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <select
                      className="v2-adm-select"
                      value={role ?? ''}
                      onChange={(e) => onRoleChange(u.id, e.target.value)}
                    >
                      {role === undefined || !ROLE_KEYS.includes(role) ? (
                        <option value="">— no role —</option>
                      ) : null}
                      {ROLE_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {PRESET_LABELS[k] ?? k}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td>
                    <div className="v2-adm-grants">
                      <span className="v2-adm-dots">
                        {SECTION_ORDER.map((sec) => {
                          const on = effective.includes(sec);
                          const locked = sec === 'overview' || isGlobal;
                          return (
                            <button
                              key={sec}
                              type="button"
                              className={`v2-adm-dot${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                              title={`${SECTION_LABELS[sec]}${
                                sec === 'overview'
                                  ? ' (always on)'
                                  : isGlobal
                                    ? ' (global admin — all on)'
                                    : on
                                      ? ' — granted'
                                      : ' — hidden'
                              }`}
                              aria-label={SECTION_LABELS[sec]}
                              aria-pressed={on}
                              disabled={locked || !GATEABLE.includes(sec)}
                              onClick={() => onToggle(u.id, sec, role, override)}
                            />
                          );
                        })}
                      </span>
                      <span className="v2-adm-glabel">{grantsLabel(effective)}</span>
                    </div>
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <div className="v2-adm-savecell">
                      {row.save === 'saved' ? (
                        <span className="v2-adm-savestate ok">Saved</span>
                      ) : row.save === 'error' ? (
                        <span className="v2-adm-savestate err" title={row.error}>
                          Error
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="v2-btn v2-adm-savebtn"
                        disabled={row.save === 'saving'}
                        onClick={() => onSave(u.id, role, override)}
                      >
                        {row.save === 'saving' ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="v2-adm-legend">
        <span className="v2-adm-leg">
          <span className="v2-adm-dot on" />
          granted — appears in their rail
        </span>
        <span className="v2-adm-leg">
          <span className="v2-adm-dot" />
          hidden — no access
        </span>
        <span className="v2-adm-leg">
          <span className="v2-adm-dot on locked" />
          locked — overview (always on) / global admin
        </span>
        <span className="v2-adm-legorder">
          Order: Overview · Support · Operations · Security · Admin · Hermes
        </span>
      </div>
    </>
  );
}
