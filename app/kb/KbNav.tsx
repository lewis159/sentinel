'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { KbDoc } from '@/lib/kb';

export default function KbNav({ docs, active }: { docs: KbDoc[]; active?: string }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? docs.filter((d) => d.title.toLowerCase().includes(term)) : docs;

  const groups: KbDoc['group'][] = ['Sections', 'Technical'];

  return (
    <div className="card" style={{ position: 'sticky', top: 78 }}>
      <input
        className="search"
        style={{ width: '100%', marginBottom: 14 }}
        placeholder="🔍 Search the KB…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <Link
        href="/kb"
        className="nav"
        style={{
          display: 'block',
          padding: '7px 10px',
          borderRadius: 8,
          marginBottom: 6,
          color: active === undefined ? '#fff' : 'var(--muted)',
          background: active === undefined ? 'rgba(45,108,255,.14)' : 'transparent',
          fontWeight: 600,
          fontSize: 13.5,
        }}
      >
        🏠 Home
      </Link>

      {groups.map((g) => {
        const items = shown.filter((d) => d.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="group" style={{ padding: '14px 10px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--faint)', fontWeight: 700 }}>
              {g}
            </div>
            {items.map((d) => {
              const on = d.slug === active;
              return (
                <Link
                  key={d.slug}
                  href={`/kb/${d.slug}`}
                  style={{
                    display: 'block',
                    padding: '7px 10px',
                    borderRadius: 8,
                    marginBottom: 2,
                    color: on ? '#fff' : 'var(--muted)',
                    background: on ? 'rgba(45,108,255,.14)' : 'transparent',
                    fontWeight: on ? 600 : 400,
                    fontSize: 13.5,
                  }}
                >
                  {d.title}
                </Link>
              );
            })}
          </div>
        );
      })}

      {!shown.length && <div className="sub" style={{ padding: '10px' }}>No matches.</div>}
    </div>
  );
}
