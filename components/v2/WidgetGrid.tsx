'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useEditMode, useEditFlush } from '@/components/EditMode';
import type { PlacedWidget } from '@/components/widgets/registry';
import './widget-grid.css';

// ---------------------------------------------------------------------------
// WidgetGrid (v2) — the reusable dashboard engine, adapted from DashboardGrid.
//
// Same react-grid-layout wiring, 5/9/12 density selector, EditMode integration
// (drag/resize only while editing) and `/api/layouts/[key]` (+ localStorage)
// persistence as v1 — but with NEW v2 panel/grid chrome (.v2-wg-*) and the
// ability to ADD and REMOVE widgets from a catalog.
//
// Persisted shape EXTENDS v1's StoredLayout with `active: string[]` (the placed
// widget ids). ACTIVE widgets = intersection of persisted `active` (or
// `defaultActive`) with the catalog ids; only active widgets render. The
// per-density `byCols` layouts are always kept reconciled to the active id set.
//
// MUST be loaded via `dynamic(..., { ssr: false })` — react-grid-layout touches
// window/ResizeObserver and is not SSR-safe.
// ---------------------------------------------------------------------------

const ResponsiveGridLayout = WidthProvider(Responsive);

const ROW_HEIGHT = 30;
const DENSITIES = [5, 9, 12] as const;
type Density = (typeof DENSITIES)[number];
const NARROW_BP = 700; // below this width → single column

// Persisted shape: active column count, one Layout[] per density visited so far
// (lazily filled, reconciled to the active set), and the active widget ids.
type StoredLayout = {
  cols: Density;
  byCols: Partial<Record<Density, Layout[]>>;
  active: string[];
};

// Derive a layout for `cols` from the canonical 12-col `full` layout. For 12 we
// use it verbatim; for narrower densities we scale each tile's width/x down
// proportionally (clamped to the column count) and keep the relative ordering.
function deriveLayout(full: Layout[], cols: Density): Layout[] {
  if (cols === 12) return full.map((l) => ({ ...l }));
  const scale = cols / 12;
  if (cols < 4) {
    const ordered = [...full].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let y = 0;
    return ordered.map((l) => {
      const h = l.h;
      const row = { ...l, x: 0, y, w: cols, minW: 1, minH: Math.min(l.minH ?? 3, h) };
      y += h;
      return row;
    });
  }
  return full.map((l) => {
    const w = Math.max(1, Math.min(cols, Math.round(l.w * scale)));
    const x = Math.max(0, Math.min(cols - w, Math.round(l.x * scale)));
    return { ...l, x, w, minW: Math.min(l.minW ?? 2, w) };
  });
}

// Reconcile a saved Layout[] with the CURRENT active id set: drop tiles whose id
// is not active, and append a default (stacked below) for any active id missing
// from the save. `full` supplies default positions/sizes for every catalog id.
function reconcileLayout(raw: any, cols: Density, full: Layout[], activeIds: Set<string>): Layout[] {
  const def = deriveLayout(full, cols).filter((l) => activeIds.has(l.i));
  // No saved layout → use the canonical default positions VERBATIM (preserving
  // each tile's x/y). Previously this stacked every tile at x:0, which destroyed
  // the default arrangement (e.g. the KPI row) on first load.
  if (!Array.isArray(raw)) return def.map((l) => ({ ...l }));
  const kept = raw.filter((l) => l && typeof l.i === 'string' && activeIds.has(l.i)) as Layout[];
  const present = new Set(kept.map((l) => l.i));
  let nextY = kept.reduce((m, l) => Math.max(m, (l.y ?? 0) + (l.h ?? 0)), 0);
  // Append active widgets missing from a real save, stacked below (genuinely new).
  for (const d of def) {
    if (present.has(d.i)) continue;
    kept.push({ ...d, x: 0, y: nextY });
    nextY += d.h ?? 6;
    present.add(d.i);
  }
  return kept;
}

// Pick a valid, de-duplicated active list from an arbitrary saved `active` value,
// falling back to `defaultActive` when empty/invalid. All ids must be in catalog.
function pickActive(raw: any, catalogIds: Set<string>, defaultActive: string[]): string[] {
  const src: string[] = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : defaultActive;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of src) {
    if (catalogIds.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  if (out.length === 0) {
    for (const id of defaultActive) {
      if (catalogIds.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

function defaultStored(full: Layout[], defaultActive: string[], catalogIds: Set<string>): StoredLayout {
  const active = defaultActive.filter((id) => catalogIds.has(id));
  const activeSet = new Set(active);
  return { cols: 12, byCols: { 12: reconcileLayout(null, 12, full, activeSet) }, active };
}

// Tolerant migration: accepts the v2 StoredLayout shape, the legacy `Layouts`
// (breakpoint map) shape, or junk → default. Every per-density layout is
// reconciled against the resolved active id set.
function coerceStored(raw: any, full: Layout[], catalogIds: Set<string>, defaultActive: string[]): StoredLayout {
  if (raw && typeof raw === 'object' && raw.byCols && typeof raw.byCols === 'object') {
    const active = pickActive(raw.active, catalogIds, defaultActive);
    const activeSet = new Set(active);
    const cols: Density = (DENSITIES as readonly number[]).includes(raw.cols) ? raw.cols : 12;
    const byCols: Partial<Record<Density, Layout[]>> = {};
    for (const d of DENSITIES) {
      if (Array.isArray(raw.byCols[d])) byCols[d] = reconcileLayout(raw.byCols[d], d, full, activeSet);
    }
    if (!byCols[cols]) byCols[cols] = reconcileLayout(null, cols, full, activeSet);
    return { cols, byCols, active };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.lg)) {
    const active = pickActive(raw.active, catalogIds, defaultActive);
    const activeSet = new Set(active);
    return { cols: 12, byCols: { 12: reconcileLayout(raw.lg, 12, full, activeSet) }, active };
  }
  return defaultStored(full, defaultActive, catalogIds);
}

// A draggable/resizable tile in v2 chrome. Header is the drag handle in edit
// mode; the body scrolls independently so resize constrains content.
function Panel({
  title, children, editing, onRemove,
}: {
  title: string;
  children: React.ReactNode;
  editing: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="v2-wg-panel">
      <div className={`v2-wg-h${editing ? ' v2-wg-drag' : ''}`}>
        <h3>{title}</h3>
        {editing && (
          <button
            className="v2-wg-remove"
            aria-label="Remove"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            ×
          </button>
        )}
        {editing && <span className="v2-wg-grip" aria-hidden>⠿</span>}
      </div>
      <div className="v2-wg-body">{children}</div>
    </div>
  );
}

export function WidgetGrid({
  layoutKey,
  catalog,
  defaultActive,
  defaultLayout,
}: {
  /** Persistence key, e.g. 'v2-overview'. */
  layoutKey: string;
  /** ALL available widgets (id + title + component + sizes). */
  catalog: PlacedWidget[];
  /** Widget ids placed by default. */
  defaultActive: string[];
  /** 12-col default positions for the default-active ids. */
  defaultLayout: Layout[];
}) {
  const lsKey = `sentinel:layout:${layoutKey}`;
  const { editing } = useEditMode();

  const catalogIds = useMemo(() => new Set(catalog.map((w) => w.id)), [catalog]);

  // A canonical 12-col layout covering EVERY catalog widget: start from
  // `defaultLayout` (positions for default-active ids), then append a
  // default-sized tile (stacked below) for any catalog widget without an entry,
  // so added widgets always have a default position/size to fall back to.
  const fullDefaultLayout = useMemo<Layout[]>(() => {
    const byId = new Map(defaultLayout.map((l) => [l.i, l]));
    const out: Layout[] = defaultLayout.filter((l) => catalogIds.has(l.i)).map((l) => ({ ...l }));
    let nextY = out.reduce((m, l) => Math.max(m, (l.y ?? 0) + (l.h ?? 0)), 0);
    for (const w of catalog) {
      if (byId.has(w.id)) continue;
      out.push({
        i: w.id, x: 0, y: nextY, w: w.defaultSize.w, h: w.defaultSize.h,
        minW: w.minSize?.w ?? 2, minH: w.minSize?.h ?? 3,
      });
      nextY += w.defaultSize.h;
    }
    return out;
  }, [defaultLayout, catalog, catalogIds]);

  const [stored, setStored] = useState<StoredLayout>(
    () => defaultStored(fullDefaultLayout, defaultActive, catalogIds)
  );
  const [loaded, setLoaded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  // On mount: hydrate from localStorage instantly, then reconcile with the DB.
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(lsKey);
      if (cached) setStored(coerceStored(JSON.parse(cached), fullDefaultLayout, catalogIds, defaultActive));
    } catch { /* ignore bad cache */ }

    fetch(`/api/layouts/${layoutKey}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (cancelled) return;
        const saved = d?.layout;
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          const next = coerceStored(saved, fullDefaultLayout, catalogIds, defaultActive);
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

  // Close the add-widget picker whenever we leave edit mode.
  useEffect(() => { if (!editing) setShowPicker(false); }, [editing]);

  const cols = stored.cols;
  const activeSet = useMemo(() => new Set(stored.active), [stored.active]);
  const activeWidgets = useMemo(() => catalog.filter((w) => activeSet.has(w.id)), [catalog, activeSet]);
  const inactiveWidgets = useMemo(() => catalog.filter((w) => !activeSet.has(w.id)), [catalog, activeSet]);

  const activeLayout = useMemo(
    () => stored.byCols[cols] ?? reconcileLayout(null, cols, fullDefaultLayout, activeSet),
    [stored, cols, fullDefaultLayout, activeSet]
  );

  const breakpoints = useMemo(() => ({ active: NARROW_BP, narrow: 0 }), []);
  const colsMap = useMemo(() => ({ active: cols, narrow: 1 }), [cols]);
  const layouts: Layouts = useMemo(() => ({
    active: activeLayout,
    narrow: activeLayout.map((l, idx) => ({ ...l, x: 0, y: idx * 6, w: 1 })),
  }), [activeLayout]);

  const onLayoutChange = useCallback((current: Layout[], all: Layouts) => {
    if (!loaded || !editing) return;
    const next: StoredLayout = {
      cols,
      byCols: { ...stored.byCols, [cols]: all.active ?? current },
      active: stored.active,
    };
    setStored(next);
    persist(next);
  }, [loaded, editing, cols, stored.byCols, stored.active, persist]);

  const setDensity = useCallback((d: Density) => {
    setStored((prev) => {
      const set = new Set(prev.active);
      const byCols = { ...prev.byCols };
      if (!byCols[d]) byCols[d] = reconcileLayout(null, d, fullDefaultLayout, set);
      const next: StoredLayout = { cols: d, byCols, active: prev.active };
      persist(next);
      return next;
    });
  }, [persist, fullDefaultLayout]);

  const addWidget = useCallback((id: string) => {
    setStored((prev) => {
      if (prev.active.includes(id) || !catalogIds.has(id)) return prev;
      const active = [...prev.active, id];
      const set = new Set(active);
      const byCols: Partial<Record<Density, Layout[]>> = {};
      for (const d of DENSITIES) {
        if (prev.byCols[d]) byCols[d] = reconcileLayout(prev.byCols[d], d, fullDefaultLayout, set);
      }
      if (!byCols[prev.cols]) byCols[prev.cols] = reconcileLayout(prev.byCols[prev.cols] ?? null, prev.cols, fullDefaultLayout, set);
      const next: StoredLayout = { cols: prev.cols, byCols, active };
      persist(next);
      return next;
    });
    setShowPicker(false);
  }, [persist, fullDefaultLayout, catalogIds]);

  const removeWidget = useCallback((id: string) => {
    setStored((prev) => {
      if (!prev.active.includes(id)) return prev;
      const active = prev.active.filter((x) => x !== id);
      const set = new Set(active);
      const byCols: Partial<Record<Density, Layout[]>> = {};
      for (const d of DENSITIES) {
        if (prev.byCols[d]) byCols[d] = reconcileLayout(prev.byCols[d], d, fullDefaultLayout, set);
      }
      const next: StoredLayout = { cols: prev.cols, byCols, active };
      persist(next);
      return next;
    });
  }, [persist, fullDefaultLayout]);

  const resetLayout = useCallback(() => {
    setStored((prev) => {
      const active = defaultActive.filter((id) => catalogIds.has(id));
      const set = new Set(active);
      const next: StoredLayout = {
        cols: prev.cols,
        byCols: { [prev.cols]: reconcileLayout(null, prev.cols, fullDefaultLayout, set) },
        active,
      };
      persist(next);
      return next;
    });
  }, [persist, fullDefaultLayout, defaultActive, catalogIds]);

  useEditFlush(() => persist(storedRef.current, true));
  const saveNow = useCallback(() => persist(stored, true), [persist, stored]);

  return (
    <div className={`v2-wg${editing ? ' editing' : ''}`}>
      {editing && (
        <div className="v2-wg-toolbar">
          <span className="v2-wg-hint">Drag panel headers to rearrange · drag corners to resize · add or remove widgets</span>
          <div className="v2-wg-tools">
            <div className="v2-wg-density" role="group" aria-label="Grid density">
              <span className="v2-wg-density-l">Density</span>
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  className={`v2-wg-density-b${cols === d ? ' on' : ''}`}
                  onClick={() => setDensity(d)}
                  aria-pressed={cols === d}
                >
                  {d}
                </button>
              ))}
            </div>

            <div className="v2-wg-add-wrap">
              <button
                className="v2-wg-add"
                onClick={() => setShowPicker((v) => !v)}
                aria-expanded={showPicker}
                disabled={inactiveWidgets.length === 0}
              >
                ＋ Add widget
              </button>
              {showPicker && (
                <div className="v2-wg-picker" role="menu">
                  {inactiveWidgets.length === 0 ? (
                    <div className="v2-wg-picker-empty">All widgets added</div>
                  ) : (
                    inactiveWidgets.map((w) => (
                      <button
                        key={w.id}
                        className="v2-wg-picker-item"
                        role="menuitem"
                        onClick={() => addWidget(w.id)}
                      >
                        {w.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <button className="v2-wg-btn ghost" onClick={resetLayout}>Reset layout</button>
            <button className="v2-wg-btn" onClick={saveNow}>Save</button>
          </div>
        </div>
      )}

      <ResponsiveGridLayout
        className="v2-wg-rgl"
        layouts={layouts}
        breakpoints={breakpoints}
        cols={colsMap}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        draggableHandle=".v2-wg-drag"
        onLayoutChange={onLayoutChange}
        isDraggable={editing}
        isResizable={editing}
        isBounded={false}
        useCSSTransforms
      >
        {activeWidgets.map((w) => {
          const Body = w.component;
          return (
            <div key={w.id}>
              <Panel title={w.title} editing={editing} onRemove={() => removeWidget(w.id)}>
                <Body />
              </Panel>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
