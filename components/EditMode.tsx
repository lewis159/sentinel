'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

// ---------------------------------------------------------------------------
// ONE global edit mode per section page. Replaces the per-component Edit/Done
// toggles that used to live in MetricCards and TicketDashboard. While `editing`
// is true: metric-card dropdowns appear AND the ticket dashboard becomes
// draggable/resizable (grid lines + density selector + Reset visible).
//
// Leaving edit mode ("Done") must flush each consumer's pending save (the
// debounced layout PUT + metrics PUT). Consumers register a flush callback via
// `useEditFlush(fn)`; the provider invokes every registered flusher when the
// user exits edit mode.
// ---------------------------------------------------------------------------

type EditModeValue = {
  editing: boolean;
  setEditing: (on: boolean) => void;
  /** Register a flush callback; returns an unregister fn. Internal — use the
   *  `useEditFlush` hook rather than calling this directly. */
  registerFlush: (fn: () => void) => () => void;
};

const EditModeContext = createContext<EditModeValue | null>(null);

export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditingState] = useState(false);
  const flushers = useRef<Set<() => void>>(new Set());

  const registerFlush = useCallback((fn: () => void) => {
    flushers.current.add(fn);
    return () => { flushers.current.delete(fn); };
  }, []);

  const setEditing = useCallback((on: boolean) => {
    setEditingState((prev) => {
      // Transitioning edit → done: flush every consumer's pending save.
      if (prev && !on) {
        for (const fn of flushers.current) {
          try { fn(); } catch { /* a failed flush must not block the others */ }
        }
      }
      return on;
    });
  }, []);

  const value = useMemo<EditModeValue>(
    () => ({ editing, setEditing, registerFlush }),
    [editing, setEditing, registerFlush]
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

// Returns the current edit-mode state. Safe to call outside a provider (returns
// a locked, no-op default) so components stay usable in isolation.
export function useEditMode(): { editing: boolean; setEditing: (on: boolean) => void } {
  const ctx = useContext(EditModeContext);
  if (!ctx) return { editing: false, setEditing: () => {} };
  return { editing: ctx.editing, setEditing: ctx.setEditing };
}

// Register a flush callback that runs when the user exits edit mode. `fn` is
// kept in a ref so consumers can pass an inline closure without re-registering
// every render. No-op outside a provider.
export function useEditFlush(fn: () => void): void {
  const ctx = useContext(EditModeContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerFlush(() => ref.current());
  }, [ctx]);
}

// The single Edit/Done button for a section page. Place it near the breadcrumb.
export function EditModeToggle({ className }: { className?: string }) {
  const { editing, setEditing } = useEditMode();
  return (
    <button
      className={className ?? `btn sm${editing ? '' : ' ghost'}`}
      onClick={() => setEditing(!editing)}
      aria-pressed={editing}
    >
      {editing ? 'Done' : 'Edit layout'}
    </button>
  );
}
