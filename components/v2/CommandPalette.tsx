'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/app/v2/command.css';

// Custom window event the top-bar search box dispatches to open the palette.
export const OPEN_CMDK_EVENT = 'v2:open-cmdk';

type Command = {
  id: string;
  label: string;
  group: 'Jump to' | 'Actions';
  hint?: string;
  run: (router: ReturnType<typeof useRouter>) => void;
};

const goTo = (href: string) => (router: ReturnType<typeof useRouter>) => router.push(href);

// STATIC command set — jump-to destinations + actions.
const COMMANDS: Command[] = [
  { id: 'overview', label: 'Overview', group: 'Jump to', run: goTo('/v2') },
  { id: 'support', label: 'Support', group: 'Jump to', run: goTo('/v2/support') },
  { id: 'operations', label: 'Operations', group: 'Jump to', run: goTo('/v2/operations') },
  { id: 'security', label: 'Security', group: 'Jump to', run: goTo('/v2/security') },
  { id: 'admin', label: 'Admin', group: 'Jump to', run: goTo('/v2/admin') },
  { id: 'hermes-floor', label: 'Hermes Floor', group: 'Jump to', run: goTo('/v2/hermes/floor') },
  { id: 'approvals', label: 'Approvals', group: 'Jump to', run: goTo('/v2/hermes/approvals') },
  { id: 'agents', label: 'Agents', group: 'Jump to', run: goTo('/v2/hermes/agents') },
  { id: 'kb', label: 'Knowledge base', group: 'Jump to', run: goTo('/v2/kb') },
  { id: 'graph', label: 'Graph', group: 'Jump to', run: goTo('/v2/graph') },
  { id: 'settings', label: 'Settings', group: 'Jump to', run: goTo('/v2/settings') },
  { id: 'reports', label: 'Reports', group: 'Jump to', run: goTo('/v2/reports') },
  { id: 'testing', label: 'Testing', group: 'Jump to', run: goTo('/v2/testing') },
  { id: 'new-ticket', label: 'New ticket', group: 'Actions', hint: 'Support', run: goTo('/v2/support') },
  {
    id: 'run-scan',
    label: 'Run security scan',
    group: 'Actions',
    run: () => {
      // No-op placeholder — surfaces a lightweight toast in the real app.
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line no-console
        console.info('[v2] Security scan queued');
      }
    },
  },
  { id: 'ask-hermes', label: 'Ask Hermes…', group: 'Actions', run: goTo('/v2/hermes/floor') },
];

const GROUP_ORDER: Command['group'][] = ['Jump to', 'Actions'];

function ArrowIcon() {
  return (
    <svg className="v2-cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="v2-cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const openPalette = useCallback(() => {
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);

  // Filtered, flat list (in group order) used for keyboard navigation.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : COMMANDS;
    return [...matched].sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  }, [query]);

  // Grouped view for rendering. Index into the flat `results` is tracked so the
  // highlighted item and keyboard nav stay in sync across groups.
  const grouped = useMemo(() => {
    const out: { group: Command['group']; items: { cmd: Command; index: number }[] }[] = [];
    results.forEach((cmd, index) => {
      let bucket = out.find((g) => g.group === cmd.group);
      if (!bucket) {
        bucket = { group: cmd.group, items: [] };
        out.push(bucket);
      }
      bucket.items.push({ cmd, index });
    });
    return out;
  }, [results]);

  // Keep the highlighted index within bounds as the result set shrinks.
  useEffect(() => {
    setActive((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const activate = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return;
      close();
      cmd.run(router);
    },
    [close, router],
  );

  // Global hotkey (Cmd/Ctrl+K) + open-via-custom-event listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setQuery('');
            setActive(0);
          }
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_CMDK_EVENT, openPalette as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_CMDK_EVENT, openPalette as EventListener);
    };
  }, [openPalette]);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  if (!open) return null;

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="v2-cmdk-scrim" role="presentation">
      <div
        ref={panelRef}
        className="v2-cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="v2-cmdk-input-row">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="v2-cmdk-input"
            type="text"
            placeholder="Search or jump to…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="v2-cmdk-esc">esc</span>
        </div>

        <div className="v2-cmdk-list">
          {results.length === 0 ? (
            <div className="v2-cmdk-empty">No matching commands</div>
          ) : (
            grouped.map((g) => (
              <div key={g.group}>
                <div className="v2-cmdk-group-label">{g.group}</div>
                {g.items.map(({ cmd, index }) => (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`v2-cmdk-item${index === active ? ' on' : ''}`}
                    onMouseMove={() => setActive(index)}
                    onClick={() => activate(cmd)}
                  >
                    {cmd.group === 'Actions' ? <BoltIcon /> : <ArrowIcon />}
                    <span className="v2-cmdk-lbl">{cmd.label}</span>
                    {cmd.hint && <span className="v2-cmdk-hint">{cmd.hint}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="v2-cmdk-footer">
          <span><span className="v2-cmdk-k">&#8593;&#8595;</span> navigate</span>
          <span><span className="v2-cmdk-k">&#8629;</span> open</span>
          <span><span className="v2-cmdk-k">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
