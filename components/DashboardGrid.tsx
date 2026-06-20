'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useEditMode, useEditFlush } from './EditMode';
import type { PlacedWidget } from './widgets/registry';

// ---------------------------------------------------------------------------
// DashboardGrid — the reusable dashboard engine.
//
// Generalised out of TicketDashboard: it owns the react-grid-layout grid, the
// 5/9/12 density selector, the global EditMode integration (drag/resize only
// while editing), per-density layout state, and persistence to
// `/api/layouts/[layoutKey]` (+ a localStorage cache) keyed by `layoutKey`.
//
// It is widget-agnostic: callers pass `widgets` (PlacedWidget[] — id + title +
// component + default/min size) and a `defaultLayout` (a 12-col Layout[]). Each
// placed widget is rendered inside the same panel chrome (.td-panel) the ticket
// dashboard uses, so every theme keeps working unchanged.
//
// MUST be loaded via `dynamic(..., { ssr: false })` — react-grid-layout touches
// window/ResizeObserver and is not SSR-safe.
// ---------------------------------------------------------------------------

const ResponsiveGridLayout = WidthProvider(Responsive);

const ROW_HEIGHT = 30;
const DENSITIES = [5, 9, 12] as const;
type Density = (typeof DENSITIES)[number];
const NARROW_BP = 700; // below this width → single column

// Persisted shape: the active column count + one Layout[] per density visited so
// far (lazily filled). Identical to the ticket dashboard's StoredLayout so the
// `ticket-detail` saved layouts keep loading after the refactor.
type StoredLayout = { cols: Density; byCols: Partial<Record<Density, Layout[]>> };

// Derive a layout for `cols` from the canonical 12-col `defaultLayout`. For 12
// we use it verbatim; for narrower densities we scale each tile's width/x down
// proportionally (clamped to the column count) and keep the relative ordering.
function deriveLayout(defaultLayout: Layout[], cols: Density): Layout[] {
  if (cols === 12) return defaultLayout.map((l) => ({ ...l }));
  const scale = cols / 12;
  if (cols < 4) {
    // Single-column stack for tiny densities, preserving vertical order.
    const ordered = [...defaultLayout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let y = 0;
    return ordered.map((l) => {
      const h = l.h;
      const row = { ...l, x: 0, y, w: cols, minW: 1, minH: Math.min(l.minH ?? 3, h) };
      y += h;
      return row;
    });
  }
  return defaultLayout.map((l) => {
    const w = Math.max(1, Math.min(cols, Math.round(l.w * scale)));
    const x = Math.max(0, Math.min(cols - w, Math.round(l.x * scale)));
    return { ...l, x, w, minW: Math.min(l.minW ?? 2, w) };
  });
}

function defaultStored(defaultLayout: Layout[]): StoredLayout {
  return { cols: 12, byCols: { 12: deriveLayout(defaultLayout, 12) } };
}

// Reconcile a saved Layout[] with the CURRENT widget set: drop tiles whose id is
// no longer registered, and append defaults for any widget missing from the
// save (stacked below). Keeps RGL from rendering orphan tiles or omitting one.
function reconcileLayout(raw: any, cols: Density, defaultLayout: Layout[], validIds: Set<string>): Layout[] {
  const def = deriveLayout(defaultLayout, cols);
  if (!Array.isArray(raw)) return def;
  const kept = raw.filter((l) => l && typeof l.i === 'string' && validIds.has(l.i)) as Layout[];
  const present = new Set(kept.map((l) => l.i));
  let nextY = kept.reduce((m, l) => Math.max(m, (l.y ?? 0) + (l.h ?? 0)), 0);
  for (const d of def) {
    if (present.has(d.i)) continue;
    kept.push({ ...d, x: 0, y: nextY });
    nextY += d.h ?? 6;
  }
  return kept;
}

// Tolerant migration: accepts the new StoredLayout shape, the legacy `Layouts`
// (breakpoint map) shape, or junk → default. Every per-density layout is
// reconciled against the current widget id set.
function coerceStored(raw: any, defaultLayout: Layout[], validIds: Set<string>): StoredLayout {
  if (raw && typeof raw === 'object' && raw.byCols && typeof raw.byCols === 'object') {
    const cols: Density = (DENSITIES as readonly number[]).includes(raw.cols) ? raw.cols : 12;
    const byCols: Partial<Record<Density, Layout[]>> = {};
    for (const d of DENSITIES) {
      if (Array.isArray(raw.byCols[d])) byCols[d] = reconcileLayout(raw.byCols[d], d, defaultLayout, validIds);
    }
    if (!byCols[cols]) byCols[cols] = deriveLayout(defaultLayout, cols);
    return { cols, byCols };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.lg)) {
    return { cols: 12, byCols: { 12: reconcileLayout(raw.lg, 12, defaultLayout, validIds) } };
  }
  return defaultStored(defaultLayout);
}

// A draggable/resizable tile. Header is the drag handle in edit mode; the body
// scrolls independently so resize constrains content. Mirrors TicketDashboard's
// Panel so the existing CSS (.td-panel*) applies verbatim.
function Panel({ title, children, editMode }: { title: string; children: React.ReactNode; editMode: boolean }) {
  return (
    <div className="td-panel">
      <div className={`td-panel-h${editMode ? ' td-drag-handle' : ''}`}>
        <h3>{title}</h3>
        {editMode && <span className="td-grip" aria-hidden>⠿</span>}
      </div>
      <div className="td-panel-body">{children}</div>
    </div>
  );
}

export type DashboardGridProps = {
  /** Persistence key, e.g. 'ticket-detail' or 'ops-monitoring'. */
  layoutKey: string;
  /** Widgets to place (id + title + component + sizes). */
  widgets: PlacedWidget[];
  /** Canonical 12-col arrangement; narrower densities derive from it. If a
   *  widget has no entry here, one is appended from its defaultSize. */
  defaultLayout: Layout[];
};

export function DashboardGrid({ layoutKey, widgets, defaultLayout: defaultLayoutProp }: DashboardGridProps) {
  const lsKey = `sentinel:layout:${layoutKey}`;
  const { editing: editMode } = useEditMode();

  // Ensure every widget has a default tile: start from the supplied layout, then
  // append any widget without an entry (stacked below) using its defaultSize.
  const defaultLayout = useMemo<Layout[]>(() => {
    const byId = new Map(defaultLayoutProp.map((l) => [l.i, l]));
    const out: Layout[] = defaultLayoutProp.map((l) => ({ ...l }));
    let nextY = out.reduce((m, l) => Math.max(m, (l.y ?? 0) + (l.h ?? 0)), 0);
    for (const w of widgets) {
      if (byId.has(w.id)) continue;
      out.push({
        i: w.id, x: 0, y: nextY, w: w.defaultSize.w, h: w.defaultSize.h,
        minW: w.minSize?.w ?? 2, minH: w.minSize?.h ?? 3,
      });
      nextY += w.defaultSize.h;
    }
    return out;
  }, [defaultLayoutProp, widgets]);

  const validIds = useMemo(() => new Set(widgets.map((w) => w.id)), [widgets]);

  const [stored, setStored] = useState<StoredLayout>(() => defaultStored(defaultLayout));
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  // On mount: hydrate from localStorage instantly, then reconcile with the DB.
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(lsKey);
      if (cached) setStored(coerceStored(JSON.parse(cached), defaultLayout, validIds));
    } catch { /* ignore bad cache */ }

    fetch(`/api/layouts/${layoutKey}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout;
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          const next = coerceStored(saved, defaultLayout, validIds);
          setStored(next);
          try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
        }
      })
      .catch(() => { /* keep cache/default */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const persist = useCallback((next: StoredLayout, immediate = false) => {
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const put = () => {
      fetch(`/api/layouts/${layoutKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => { /* localStorage already holds it */ });
    };
    if (immediate) put();
    else saveTimer.current = setTimeout(put, 600);
  }, [layoutKey, lsKey]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const cols = stored.cols;
  const activeLayout = useMemo(
    () => stored.byCols[cols] ?? deriveLayout(defaultLayout, cols),
    [stored, cols, defaultLayout]
  );

  const breakpoints = useMemo(() => ({ active: NARROW_BP, narrow: 0 }), []);
  const colsMap = useMemo(() => ({ active: cols, narrow: 1 }), [cols]);
  const layouts: Layouts = useMemo(() => ({
    active: activeLayout,
    narrow: activeLayout.map((l, idx) => ({ ...l, x: 0, y: idx * 6, w: 1 })),
  }), [activeLayout]);

  const onLayoutChange = useCallback((current: Layout[], all: Layouts) => {
    if (!loaded || !editMode) return;
    const next: StoredLayout = {
      cols,
      byCols: { ...stored.byCols, [cols]: all.active ?? current },
    };
    setStored(next);
    persist(next);
  }, [loaded, editMode, cols, stored.byCols, persist]);

  const setDensity = useCallback((d: Density) => {
    setStored((prev) => {
      const byCols = { ...prev.byCols };
      if (!byCols[d]) byCols[d] = deriveLayout(defaultLayout, d);
      const next: StoredLayout = { cols: d, byCols };
      persist(next);
      return next;
    });
  }, [persist, defaultLayout]);

  const resetLayout = useCallback(() => {
    setStored((prev) => {
      const next: StoredLayout = {
        cols: prev.cols,
        byCols: { ...prev.byCols, [prev.cols]: deriveLayout(defaultLayout, prev.cols) },
      };
      persist(next);
      return next;
    });
  }, [persist, defaultLayout]);

  useEditFlush(() => persist(storedRef.current, true));
  const saveNow = useCallback(() => persist(stored, true), [persist, stored]);

  return (
    <div>
      {editMode && (
        <div className="row spread mb td-toolbar">
          <span className="sub">Drag panel headers to rearrange · drag corners to resize</span>
          <div className="row" style={{ gap: 8 }}>
            <div className="td-density" role="group" aria-label="Grid density">
              <span className="td-density-l">Density</span>
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  className={`td-density-b${cols === d ? ' on' : ''}`}
                  onClick={() => setDensity(d)}
                  aria-pressed={cols === d}
                >
                  {d}
                </button>
              ))}
            </div>
            <button className="btn ghost sm" onClick={resetLayout}>Reset layout</button>
            <button className="btn sm" onClick={saveNow}>Save</button>
          </div>
        </div>
      )}

      <ResponsiveGridLayout
        className={`td-rgl${editMode ? ' td-editing' : ''}`}
        layouts={layouts}
        breakpoints={breakpoints}
        cols={colsMap}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        draggableHandle=".td-drag-handle"
        onLayoutChange={onLayoutChange}
        isDraggable={editMode}
        isResizable={editMode}
        isBounded={false}
        useCSSTransforms
      >
        {widgets.map((w) => {
          const Body = w.component;
          return (
            <div key={w.id}>
              <Panel title={w.title} editMode={editMode}>
                <Body />
              </Panel>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
