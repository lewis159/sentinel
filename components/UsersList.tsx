'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ESTATE_APPS, ACCESS_LEVEL_LABEL, type AccessLevel } from '@/lib/apps';

type UserRow = {
  id: string;
  name: string;
  email: string;
  access: Record<string, AccessLevel>;
};

const AVATAR_COLORS = ['#2D6CFF', '#7c5cff', '#0ea5a3', '#d4574a', '#c9952b'];

function initials(name: string) {
  const parts = name.replace(/[*._-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Summarise a user's per-app grants as small tags (apps with non-none levels).
function grantTags(access: Record<string, AccessLevel>) {
  const granted = ESTATE_APPS.filter((a) => (access[a.id] ?? 'none') !== 'none');
  if (granted.length === 0) return <span className="sub">No estate access</span>;
  return (
    <div className="row wrap" style={{ gap: 5 }}>
      {granted.map((a) => (
        <span key={a.id} className={`tag ${access[a.id] === 'admin' ? 'st-blue' : 'st-mute'}`}>
          {a.name} · {ACCESS_LEVEL_LABEL[access[a.id]!]}
        </span>
      ))}
    </div>
  );
}

// Searchable estate-user table. Rows link to the per-user access panel.
export function UsersList({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    : users;

  return (
    <div>
      <div className="mb">
        <input
          className="input"
          placeholder="Search users by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </div>
      <div className="card pad0">
        <table>
          <thead><tr><th>User</th><th>Estate access</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={2}><span className="sub">No users match “{query}”.</span></td></tr>
            ) : filtered.map((u, i) => (
              <tr key={u.id} className="clickable">
                <td>
                  <Link href={`/users/${encodeURIComponent(u.id)}`}>
                    <div className="row" style={{ gap: 10 }}>
                      <span style={{ width: 30, height: 30, borderRadius: '50%', background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{initials(u.name)}</span>
                      <span><div className="t">{u.name}</div><div className="d">{u.email}</div></span>
                    </div>
                  </Link>
                </td>
                <td>{grantTags(u.access)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
