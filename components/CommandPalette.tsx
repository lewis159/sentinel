'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKSPACES } from '@/lib/nav';
import { findings, tickets, components } from '@/lib/mock';

type Entry = { label: string; href: string; icon: string; kind: string };

// Active-row fill uses the theme accent so the palette matches every palette.
const BRAND = 'var(--accent)';

function buildIndex(): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();

  // Nav items across both workspaces (deduped by href).
  for (const ws of Object.values(WORKSPACES)) {
    for (const grp of ws.nav) {
      for (const item of grp.items) {
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        out.push({ label: item.label, href: item.href, icon: item.icon, kind: 'Nav' });
      }
    }
  }

  // Entity shortcuts.
  for (const f of findings) {
    out.push({ label: `${f.ref} · ${f.title}`, href: `/findings/${f.ref}`, icon: '⚠', kind: 'Finding' });
  }
  for (const t of tickets) {
    out.push({ label: `${t.ref} · ${t.title}`, href: `/tickets/${t.ref}`, icon: '🎫', kind: 'Ticket' });
  }
  for (const c of components) {
    out.push({ label: `${c.key} · ${c.name}`, href: `/components/${c.key}`, icon: '⬡', kind: 'Component' });
  }

  return out;
}

const MAX_RESULTS = 8;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(buildIndex, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? index.filter((e) => e.label.toLowerCase().includes(q))
      : index;
    return filtered.slice(0, MAX_RESULTS);
  }, [index, query]);

  // Global open/close listener.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isToggle) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset state + focus whenever it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      // Focus after the panel mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep selection in range as results change.
  useEffect(() => {
    setSel((s) => (s >= results.length ? 0 : s));
  }, [results.length]);

  if (!open) return null;

  function go(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      onMouseDown={(e) => {
        // Click on the backdrop (not the panel) closes.
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'color-mix(in srgb, var(--bg) 55%, transparent)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        className="card"
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search pages, findings, tickets, components…"
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 15,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        />
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 ? (
            <div className="sub" style={{ padding: '16px', textAlign: 'center' }}>
              No matches
            </div>
          ) : (
            results.map((r, i) => {
              const active = i === sel;
              return (
                <div
                  key={`${r.kind}-${r.href}`}
                  className="row"
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(r);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: active ? BRAND : 'transparent',
                    color: active ? 'var(--on-accent)' : 'inherit',
                  }}
                >
                  <span style={{ width: 18, textAlign: 'center', flex: '0 0 auto' }}>{r.icon}</span>
                  <span
                    style={{
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r.label}
                  </span>
                  <span
                    className={active ? 'mono' : 'mono sub'}
                    style={{
                      flex: '0 0 auto',
                      fontSize: 11,
                      opacity: active ? 0.85 : undefined,
                      color: active ? '#fff' : undefined,
                    }}
                  >
                    {r.kind}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
